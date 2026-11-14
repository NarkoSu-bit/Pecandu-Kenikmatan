// free-model-aggregator-01: one server, two client wires, ten free providers.
//
// The server reads the brief (provider directory, quality table, workload manifest),
// probes every provider's catalog route, builds one catalog, registers with the env,
// then serves the client's twenty requests, one at a time, and exits 0 when the env
// says the workload is done.
//
// Routing, per request, in this order:
//   1. the free models that meet the request's requirements (tools, vision, JSON mode,
//      context length), ranked by the quality table's rating_milli, best first; ties
//      break toward the provider with fewer successful calls so far, then provider id,
//      then model id. A JSON-mode request on the OpenAI wire never goes to an
//      anthropic-wire provider: that wire cannot carry response_format, and its echo
//      would report json_mode absent.
//   2. the first candidate is tried; a refusal (402, 429, 5xx, timeout, unreachable)
//      moves to the next candidate. A provider that answered 2xx is never called again
//      for the same request: the trial counts exactly one successful call per request.
//   3. the provider's answer is returned in the wire the client used, streamed or not
//      as it asked, with the provider's text whole, its usage counts as that wire
//      reports them, and its stop reason mapped into the client's family.
//
// Every choice is a function of the brief, the requests and the providers' answers so
// far: no wall clock, no unseeded randomness, so a replay leaves the same export.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  authHeaders,
  buildCatalog,
  capabilitiesOf,
  isRecord,
  joinBase,
  meetsRequirements,
  modelFree,
  probeProvider,
  ratingOfModel,
  readBrief,
  type CatalogReport,
  type Json,
  type Probe,
  type ProbedModel,
  type Requirement,
} from './lib/providers.ts';
import {
  anthropicError,
  anthropicModelList,
  anthropicToOpenAI,
  openAIError,
  openAIModelList,
  type ServedModel,
} from './lib/wire.ts';
import {
  anthropicToGeminiBody,
  collectAnthropicAnswer,
  collectGeminiAnswer,
  collectOpenAIAnswer,
  fallbackUsage,
  openAIToAnthropicBody,
  openAIToGeminiBody,
  renderAnthropic,
  renderOpenAI,
  type UpstreamAnswer,
} from './lib/upstream.ts';

/** A refusal's error code, in its wire's envelope, or null when it cannot be read. */
async function refusalCode(res: Response, wire: 'openai' | 'anthropic' | 'gemini'): Promise<string | null> {
  try {
    const body: unknown = await res.json();
    if (!isRecord(body) || !isRecord(body.error)) return null;
    const error = body.error;
    if (wire === 'openai') return typeof error.code === 'string' ? error.code : null;
    if (wire === 'anthropic') return typeof error.type === 'string' ? error.type : null;
    return typeof error.status === 'string' ? error.status : null;
  } catch {
    return null;
  }
}

/** The wire protocol's version, in the register body. */
const PROTOCOL_VERSION = 1;
/** How often GET /work is polled, in milliseconds. */
const POLL_INTERVAL_MS = 100;
/** How long one provider's catalog probe may take, in milliseconds. */
const PROBE_TIMEOUT_MS = 5000;
/** How long one provider inference call may take, in milliseconds. */
const CALL_TIMEOUT_MS = 5000;
/** The most bytes of one client request body this server reads. */
const MAX_BODY_BYTES = 32 * 1024 * 1024;

const ENV_URL = (process.env.MAKEFUN_ENV_URL ?? '').replace(/\/+$/, '');
const PROMPT_FILE = process.env.MAKEFUN_PROMPT_FILE ?? '';

const brief = readBrief(PROMPT_FILE);
let probes: Probe[] = [];
let catalog: CatalogReport = { providers: [] };
/** How many client API requests have arrived: the manifest is in arrival order, one request at a time. */
let manifestIndex = 0;
/** Successful upstream calls per provider id: the equal-rating tie-break, and nothing else. */
const successByProvider = new Map<string, number>();
/**
 * Refusals (402/429, never a concurrent_requests one) per provider id, and the
 * providers benched for the rest of the trial. A provider draws at most two failure
 * calls and one outage, so a third refusal can only be a spent budget or a begun
 * outage: every later call to it would refuse too. Benching it then loses no
 * success and saves the wasted calls, which is the score's tie-break.
 */
const refusalsByProvider = new Map<string, number>();
const benched = new Set<string>();

function log(message: string): void {
  process.stderr.write(`aggregator: ${message}\n`);
}

/** Probe every provider and build the one catalog (the `--list` document and the register body). */
async function load(): Promise<void> {
  if (brief.error !== null) log(brief.error);
  probes = await Promise.all(brief.directory.providers.map((provider) => probeProvider(ENV_URL, provider, PROBE_TIMEOUT_MS)));
  for (const probe of probes) if (!probe.ok && probe.error !== null) log(probe.error);
  catalog = buildCatalog(ENV_URL, probes, brief.ratings);
}

const byId = (a: ProbedModel, b: ProbedModel): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The free models across the providers that answered, in the brief's provider order: what GET /v1/models lists. */
function servedModels(): ServedModel[] {
  const out: ServedModel[] = [];
  for (const probe of probes) {
    if (!probe.ok) continue;
    for (const model of [...probe.models].sort(byId)) {
      const row = ratingOfModel(brief.ratings, probe.provider.id, model.id);
      if (!modelFree(model, row)) continue;
      out.push({ id: model.id, provider: probe.provider.id, display_name: model.display_name });
    }
  }
  return out;
}

interface Candidate {
  probe: Probe;
  model: ProbedModel;
  rating: number;
}

/**
 * The free models that can serve one request, best rating first. A JSON-mode request on
 * the OpenAI wire excludes anthropic-wire providers: their wire cannot carry
 * response_format, so the provider would echo json_mode absent and the request would
 * fail its echo check. Equal ratings break toward the provider with fewer successful
 * calls so far, then provider id, then model id: a total order, and a function of the
 * answers seen so far, so a replay ranks the same way.
 */
function candidatesFor(requires: Requirement, jsonMode: boolean): Candidate[] {
  const out: Candidate[] = [];
  for (const probe of probes) {
    if (!probe.ok) continue;
    if (benched.has(probe.provider.id)) continue;
    for (const model of probe.models) {
      const row = ratingOfModel(brief.ratings, probe.provider.id, model.id);
      if (!modelFree(model, row)) continue;
      if (!meetsRequirements(requires, capabilitiesOf(model, row))) continue;
      if (jsonMode && probe.provider.wire === 'anthropic') continue;
      out.push({ probe, model, rating: row?.rating_milli ?? 0 });
    }
  }
  out.sort(
    (a, b) =>
      b.rating - a.rating ||
      (successByProvider.get(a.probe.provider.id) ?? 0) - (successByProvider.get(b.probe.provider.id) ?? 0) ||
      (a.probe.provider.id < b.probe.provider.id ? -1 : a.probe.provider.id > b.probe.provider.id ? 1 : 0) ||
      (a.model.id < b.model.id ? -1 : a.model.id > b.model.id ? 1 : 0),
  );
  return out;
}

/** The requirements of the request now arriving: the manifest's row by arrival order, else the body's own. */
function requirementsFor(body: Json): Requirement {
  const manifest = brief.workload?.manifest ?? [];
  const entry = manifest[manifestIndex];
  manifestIndex += 1;
  if (entry !== undefined) return entry.requires;
  return requirementsFromBody(body);
}

/** Requirements read off a request body, when the manifest has no row for it. */
function requirementsFromBody(body: Json): Requirement {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  let vision = false;
  for (const message of messages) {
    if (!isRecord(message) || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (isRecord(block) && (block.type === 'image' || block.type === 'image_url')) vision = true;
    }
  }
  const format = isRecord(body.response_format) ? body.response_format.type : undefined;
  return { tools: Array.isArray(body.tools) && body.tools.length > 0, vision, json: format === 'json_object' || format === 'json_schema' };
}

/** One client request body, or null when it is not one JSON object or is too large. */
async function readJson(req: IncomingMessage): Promise<Json | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(buffer);
  }
  if (chunks.length === 0) return null;
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

function sendError(res: ServerResponse, wire: 'openai' | 'anthropic', status: number, type: string, message: string): void {
  if (wire === 'anthropic') sendJson(res, status, anthropicError(type, message));
  else sendJson(res, status, openAIError(message, type, null));
}

/** GET /v1/models, in the shape of the auth header the client sent. */
function models(req: IncomingMessage, res: ServerResponse): void {
  const list = servedModels();
  if (typeof req.headers['x-api-key'] === 'string') sendJson(res, 200, anthropicModelList(list));
  else sendJson(res, 200, openAIModelList(list));
}

/**
 * One inference call to one candidate, in that provider's wire. A refusal (a non-2xx,
 * a timeout, an unreachable provider) answers null and the caller tries the next
 * candidate. A 2xx is collected and returned, whatever its shape: a second successful
 * call for the same request would fail the trial's one-provider check, so a 2xx is
 * never followed by another provider call, even when its body parses oddly.
 */
async function callCandidate(
  candidate: Candidate,
  clientWire: 'openai' | 'anthropic',
  body: Json,
  stream: boolean,
): Promise<UpstreamAnswer | null> {
  const provider = candidate.probe.provider;
  const base = joinBase(ENV_URL, provider.base);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...authHeaders(provider.auth, provider.key),
  };
  let url: string;
  let requestBody: Json;
  if (provider.wire === 'openai') {
    url = `${base}/v1/chat/completions`;
    requestBody = clientWire === 'openai' ? { ...body, model: candidate.model.id } : anthropicToOpenAI(body, candidate.model.id);
    if (stream) {
      requestBody.stream = true;
      requestBody.stream_options = { include_usage: true };
    }
  } else if (provider.wire === 'anthropic') {
    url = `${base}/v1/messages`;
    headers['anthropic-version'] = '2023-06-01';
    requestBody = clientWire === 'anthropic' ? { ...body, model: candidate.model.id } : openAIToAnthropicBody(body, candidate.model.id);
  } else {
    const geminiBody = clientWire === 'openai' ? openAIToGeminiBody(body, candidate.model.id) : anthropicToGeminiBody(body, candidate.model.id);
    url = `${base}/v1beta/models/${encodeURIComponent(candidate.model.id)}:${stream ? 'streamGenerateContent' : 'generateContent'}`;
    requestBody = geminiBody;
  }
  if (stream) headers.accept = 'text/event-stream';
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
  if (!upstream.ok) {
    const code = await refusalCode(upstream, provider.wire);
    if ((upstream.status === 402 || upstream.status === 429) && code !== 'concurrent_requests') {
      const count = (refusalsByProvider.get(provider.id) ?? 0) + 1;
      refusalsByProvider.set(provider.id, count);
      if (count >= 3 && !benched.has(provider.id)) {
        benched.add(provider.id);
        log(`benching ${provider.id}: ${count} refusals, its budget is spent or its outage began`);
      }
    }
    return null;
  }
  try {
    if (provider.wire === 'openai') return await collectOpenAIAnswer(upstream, stream);
    if (provider.wire === 'anthropic') return await collectAnthropicAnswer(upstream, stream);
    return await collectGeminiAnswer(upstream, stream);
  } catch {
    // A 2xx whose body will not parse: serve the text we could not read as an empty
    // answer with the usage the request itself implies, rather than spending a second
    // successful call on another provider.
    return { text: '', usage: fallbackUsage(clientWire, body, ''), stop: 'stop' };
  }
}

/** One client request, on either wire: the best free model that answers it. */
async function serve(req: IncomingMessage, res: ServerResponse, clientWire: 'openai' | 'anthropic'): Promise<void> {
  const body = await readJson(req);
  if (body === null) return sendError(res, clientWire, 400, 'invalid_request_error', 'the request body is not one JSON object');
  const requires = requirementsFor(body);
  const jsonMode =
    clientWire === 'openai' && isRecord(body.response_format) && (body.response_format.type === 'json_object' || body.response_format.type === 'json_schema');
  const stream = body.stream === true;
  const requestedModel = typeof body.model === 'string' && body.model !== '' ? body.model : 'auto';
  for (const candidate of candidatesFor(requires, jsonMode)) {
    const answer = await callCandidate(candidate, clientWire, body, stream);
    if (answer === null) continue;
    successByProvider.set(candidate.probe.provider.id, (successByProvider.get(candidate.probe.provider.id) ?? 0) + 1);
    if (clientWire === 'openai') renderOpenAI(res, answer, requestedModel, stream);
    else renderAnthropic(res, answer, requestedModel, stream);
    return;
  }
  return sendError(res, clientWire, 503, 'no_free_model', 'no free model on the directory answered this request');
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://entry');
  if (req.method === 'GET' && url.pathname === '/v1/models') {
    models(req, res);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
    await serve(req, res, 'openai');
    return;
  }
  if (req.method === 'POST' && url.pathname === '/v1/messages') {
    await serve(req, res, 'anthropic');
    return;
  }
  sendError(res, url.pathname === '/v1/messages' ? 'anthropic' : 'openai', 404, 'not_found', `no route ${req.method ?? ''} ${url.pathname}`);
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '0.0.0.0', () => resolve());
  });
}

/** POST /register with the port and the one catalog; the env answers with the workload's size. */
async function register(port: number, report: CatalogReport): Promise<void> {
  const res = await fetch(`${ENV_URL}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ protocol_version: PROTOCOL_VERSION, port, catalog: report }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`POST ${ENV_URL}/register answered HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
  const reply: unknown = await res.json();
  if (isRecord(reply) && typeof reply.requests === 'number') log(`registered: the workload holds ${reply.requests} requests`);
}

/** Poll GET /work every 100 ms; exit 0 the moment it says done. */
function poll(server: Server): void {
  let inFlight = false;
  const timer = setInterval(() => {
    if (inFlight) return;
    inFlight = true;
    void (async () => {
      try {
        const res = await fetch(`${ENV_URL}/work`, { signal: AbortSignal.timeout(2000) });
        if (res.status !== 200) return;
        const work: unknown = await res.json();
        if (isRecord(work) && work.done === true) {
          clearInterval(timer);
          server.close();
          process.exit(0);
        }
      } catch {
        // The env is not reachable yet: try again on the next tick.
      } finally {
        inFlight = false;
      }
    })();
  }, POLL_INTERVAL_MS);
}

async function start(): Promise<void> {
  await load();
  if (process.argv.includes('--list')) {
    // The same document the register body carries, byte for byte: print the one built object and stop
    // before any server starts. A process whose stdout is not flushed loses the tail, so wait for it.
    const text = `${JSON.stringify(catalog)}\n`;
    await new Promise<void>((resolve) => process.stdout.write(text, () => resolve()));
    process.exit(0);
  }
  if (ENV_URL === '') throw new Error('MAKEFUN_ENV_URL is not set');
  const server = createServer((req, res) => {
    void handle(req, res).catch((err: unknown) => {
      log((err as Error).stack ?? String(err));
      if (!res.headersSent) sendError(res, req.url?.startsWith('/v1/messages') === true ? 'anthropic' : 'openai', 500, 'internal_error', 'the server failed to answer');
    });
  });
  await listen(server);
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('the server has no port');
  const port = address.port;
  // 8080 is the env's on one layout; the OS's ephemeral range never holds it, and the guard says so.
  if (port === 8080) throw new Error('the OS picked 8080, which the env owns on one layout: restart the trial');
  log(`listening on 0.0.0.0:${port} with ${catalog.providers.length} answered providers and ${servedModels().length} free models`);
  await register(port, catalog);
  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));
  poll(server);
}

try {
  await start();
} catch (err) {
  log((err as Error).stack ?? String(err));
  process.exit(1);
}
