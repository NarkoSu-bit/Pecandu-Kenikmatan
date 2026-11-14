# free-model-aggregator-01

One server that answers the OpenAI Chat Completions API and the Anthropic Messages
API over ten simulated free-tier providers, picking the best free model for each of
the twenty requests the trial sends.

## Run it

```sh
node main.ts            # reads MAKEFUN_PROMPT_FILE, registers with MAKEFUN_ENV_URL
node main.ts --list     # prints the catalog document and exits 0
```

Node 22 standard library only; TypeScript runs directly.

## How it routes

- Candidates are the free models that meet a request's requirements (tools, vision,
  JSON mode, context length), ranked by the quality table's rating, best first.
  Equal ratings break toward the provider with fewer successful calls so far.
- A JSON-mode request on the OpenAI wire never goes to an anthropic-wire provider:
  that wire cannot carry `response_format`, so its echo would report JSON mode
  absent.
- A refusal (402, 429, 5xx, timeout) moves to the next candidate. A provider that
  answered 2xx is never called again for the same request: the trial counts
  exactly one successful call per request.
- A provider is benched for the rest of the trial after three refusals: it draws
  at most two failure calls and one outage, so a third refusal can only be a spent
  budget or a begun outage, and every later call to it would refuse too.

## Wires

The client speaks OpenAI or Anthropic; the providers speak OpenAI, Anthropic or
Gemini. The server translates each request into the provider's wire (system prompt,
user text and images, tool definitions, `max_tokens`, stop sequences, JSON mode),
collects the provider's answer, and renders it back in the client's wire, streamed
or not as asked, with the provider's text whole, its usage counts, and its stop
reason mapped into the client's family.

## Layout

- `main.ts` — the server: brief, catalog probe, register, routes, routing, failover.
- `lib/providers.ts` — the brief's types and parser, auth headers, catalog probe.
- `lib/wire.ts` — the Anthropic/OpenAI translations and SSE writers.
- `lib/upstream.ts` — the upstream request builders, answer collectors and client
  renderers for all three provider wires.
