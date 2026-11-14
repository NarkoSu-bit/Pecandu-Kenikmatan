// The upstream wires and the client renderers.
//
// The trial's client speaks OpenAI or Anthropic; the providers speak OpenAI, Anthropic
// or Gemini. This file translates a client request into a provider's wire, collects a
// provider's answer (JSON or server-sent events) into one { text, usage, stop } value,
// and renders that value back in the wire the client used.
//
// The translations are written against the echo the provider returns: the provider
// echoes the system text, the user text, the tool names, max_tokens, the stop
// sequences, the image and the JSON mode it parsed, and the client compares that echo
// with what it sent. So every translated field must carry the same bytes: the system
// prompt, the user text (images included), the tool names in order, max_tokens, the
// stops, and JSON mode where the wire can carry it. A field rewritten or dropped
// loses the request, so the builders below pass each one through in the receiving
// wire's spelling and never invent one the client did not send.

import type { ServerResponse } from 'node:http';
import { isRecord, type Json } from './providers.ts';

/** One provider answer, collected: the text whole, the usage as the wire reports it, the stop reason. */
export interface UpstreamAnswer {
  text: string;
  usage: { input: number; output: number };
  stop: string;
}

/** A fixed epoch second for every rendered completion's `created`: nothing reads the clock. */
const FIXED_CREATED = 1767225600;
/** The width the providers split streamed text into: the renderers match it. */
const SSE_DELTA_CHARS = 13;

/** The text of a string or of a block array's text blocks; '' when there is none. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.flatMap((b) => (isRecord(b) && b.type === 'text' && typeof b.text === 'string' ? [b.text] : [])).join('\n');
}

/** The system text of an OpenAI body: its system messages' text, joined as the provider joins it. */
function openAISystemText(body: Json): string {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const parts: string[] = [];
  for (const message of messages) {
    if (!isRecord(message) || message.role !== 'system') continue;
    const text = textOf(message.content);
    if (text !== '') parts.push(text);
  }
  return parts.join('\n');
}

/** The tool names of an OpenAI body, in order. */
function openAIToolNames(body: Json): string[] {
  const out: string[] = [];
  if (Array.isArray(body.tools)) {
    for (const tool of body.tools) {
      if (isRecord(tool) && isRecord(tool.function) && typeof tool.function.name === 'string') out.push(tool.function.name);
    }
  }
  return out;
}

/** The tool names of an Anthropic body, in order. */
function anthropicToolNames(body: Json): string[] {
  const out: string[] = [];
  if (Array.isArray(body.tools)) {
    for (const tool of body.tools) {
      if (isRecord(tool) && typeof tool.name === 'string') out.push(tool.name);
    }
  }
  return out;
}

/** A data: URL's media type and base64 payload, or null when it is not one. */
function parseDataUrl(url: string): { media: string; data: string } | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  if (match === null) return null;
  return { media: match[1] ?? 'image/png', data: match[2] ?? '' };
}

/** One OpenAI content part as an Anthropic content block; null for the rest. */
function openAIPartToAnthropic(block: Json): Json | null {
  if (block.type === 'text' && typeof block.text === 'string') return { type: 'text', text: block.text };
  if (block.type === 'image_url' && isRecord(block.image_url) && typeof block.image_url.url === 'string') {
    const url = block.image_url.url;
    const data = parseDataUrl(url);
    if (data !== null) return { type: 'image', source: { type: 'base64', media_type: data.media, data: data.data } };
    return { type: 'image', source: { type: 'url', url } };
  }
  return null;
}

/**
 * An OpenAI Chat Completions request as an Anthropic Messages request naming `model`.
 * The system prompt becomes the system field, image parts become image blocks, tool
 * definitions and tool choice are rewritten, and the output cap, temperature, top_p,
 * stop sequences and streaming pass through. response_format has no Anthropic spelling
 * and is never sent: JSON-mode requests are never routed to an anthropic-wire
 * provider.
 */
export function openAIToAnthropicBody(body: Json, model: string): Json {
  const system = openAISystemText(body);
  const messages: Json[] = [];
  const source = Array.isArray(body.messages) ? body.messages : [];
  for (const raw of source) {
    if (!isRecord(raw)) continue;
    if (raw.role === 'system') continue;
    if (raw.role === 'assistant') {
      const blocks: Json[] = [];
      if (typeof raw.content === 'string') {
        if (raw.content !== '') blocks.push({ type: 'text', text: raw.content });
      } else if (Array.isArray(raw.content)) {
        for (const block of raw.content) {
          if (!isRecord(block)) continue;
          if (block.type === 'text' && typeof block.text === 'string') blocks.push({ type: 'text', text: block.text });
        }
      }
      const calls = Array.isArray(raw.tool_calls) ? raw.tool_calls : [];
      for (const call of calls) {
        if (!isRecord(call) || !isRecord(call.function)) continue;
        let input: Json = {};
        const args = call.function.arguments;
        if (isRecord(args)) input = args;
        else if (typeof args === 'string' && args.trim() !== '') {
          try {
            const parsed: unknown = JSON.parse(args);
            if (isRecord(parsed)) input = parsed;
          } catch {
            // Not JSON: an empty input.
          }
        }
        blocks.push({
          type: 'tool_use',
          id: typeof call.id === 'string' ? call.id : '',
          name: typeof call.function.name === 'string' ? call.function.name : '',
          input,
        });
      }
      messages.push({ role: 'assistant', content: blocks });
      continue;
    }
    if (raw.role === 'tool') {
      const content = typeof raw.content === 'string' ? raw.content : textOf(raw.content);
      messages.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: typeof raw.tool_call_id === 'string' ? raw.tool_call_id : '', content }],
      });
      continue;
    }
    if (typeof raw.content === 'string') {
      messages.push({ role: 'user', content: raw.content });
      continue;
    }
    if (!Array.isArray(raw.content)) continue;
    const blocks: Json[] = [];
    for (const block of raw.content) {
      if (!isRecord(block)) continue;
      const part = openAIPartToAnthropic(block);
      if (part !== null) blocks.push(part);
    }
    messages.push({ role: 'user', content: blocks });
  }

  const out: Json = { model, messages };
  if (system !== '') out.system = system;
  const maxTokens = typeof body.max_tokens === 'number' ? body.max_tokens : typeof body.max_completion_tokens === 'number' ? body.max_completion_tokens : undefined;
  if (maxTokens !== undefined) out.max_tokens = maxTokens;
  if (typeof body.temperature === 'number') out.temperature = body.temperature;
  if (typeof body.top_p === 'number') out.top_p = body.top_p;
  if (typeof body.stop === 'string') out.stop_sequences = [body.stop];
  else if (Array.isArray(body.stop) && body.stop.length > 0) out.stop_sequences = body.stop.filter((s): s is string => typeof s === 'string');
  if (Array.isArray(body.tools)) {
    const tools = body.tools.flatMap((raw) => {
      if (!isRecord(raw) || !isRecord(raw.function) || typeof raw.function.name !== 'string') return [];
      return [
        {
          name: raw.function.name,
          description: typeof raw.function.description === 'string' ? raw.function.description : '',
          input_schema: isRecord(raw.function.parameters) ? raw.function.parameters : { type: 'object', properties: {} },
        },
      ];
    });
    if (tools.length > 0) out.tools = tools;
  }
  const choice = body.tool_choice;
  if (choice === 'auto') out.tool_choice = { type: 'auto' };
  else if (choice === 'required') out.tool_choice = { type: 'any' };
  else if (choice === 'none') out.tool_choice = { type: 'none' };
  else if (isRecord(choice) && choice.type === 'function' && isRecord(choice.function) && typeof choice.function.name === 'string') {
    out.tool_choice = { type: 'tool', name: choice.function.name };
  }
  if (body.stream === true) out.stream = true;
  return out;
}

/** One OpenAI message's content as Gemini parts: text, inline image data, or a file URI. */
function openAIContentToGeminiParts(content: unknown): Json[] {
  const parts: Json[] = [];
  if (typeof content === 'string') {
    if (content !== '') parts.push({ text: content });
    return parts;
  }
  if (!Array.isArray(content)) return parts;
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type === 'text' && typeof block.text === 'string') parts.push({ text: block.text });
    else if (block.type === 'image_url' && isRecord(block.image_url) && typeof block.image_url.url === 'string') {
      const url = block.image_url.url;
      const data = parseDataUrl(url);
      if (data !== null) parts.push({ inlineData: { mimeType: data.media, data: data.data } });
      else parts.push({ fileData: { fileUri: url } });
    }
  }
  return parts;
}

/** One Anthropic message's content as Gemini parts: text, inline image data, or a file URI. */
function anthropicContentToGeminiParts(content: unknown): Json[] {
  const parts: Json[] = [];
  if (typeof content === 'string') {
    if (content !== '') parts.push({ text: content });
    return parts;
  }
  if (!Array.isArray(content)) return parts;
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type === 'text' && typeof block.text === 'string') parts.push({ text: block.text });
    else if (block.type === 'image' && isRecord(block.source)) {
      const source = block.source;
      if (source.type === 'base64' && typeof source.data === 'string') {
        parts.push({ inlineData: { mimeType: typeof source.media_type === 'string' ? source.media_type : 'image/png', data: source.data } });
      } else if (source.type === 'url' && typeof source.url === 'string') {
        parts.push({ fileData: { fileUri: source.url } });
      }
    }
  }
  return parts;
}

/** The generationConfig for a Gemini call: cap, stops, JSON mode, sampling, each only when sent. */
function geminiConfig(body: Json, jsonMode: boolean): Json {
  const config: Json = {};
  const maxTokens = typeof body.max_tokens === 'number' ? body.max_tokens : typeof body.max_completion_tokens === 'number' ? body.max_completion_tokens : undefined;
  if (maxTokens !== undefined) config.maxOutputTokens = maxTokens;
  const stops = Array.isArray(body.stop) ? body.stop.filter((s): s is string => typeof s === 'string') : Array.isArray(body.stop_sequences) ? body.stop_sequences.filter((s): s is string => typeof s === 'string') : [];
  if (stops.length > 0) config.stopSequences = stops;
  if (jsonMode) config.responseMimeType = 'application/json';
  if (typeof body.temperature === 'number') config.temperature = body.temperature;
  if (typeof body.top_p === 'number') config.top_p = body.top_p;
  return config;
}

/**
 * An OpenAI Chat Completions request as a Gemini generateContent body. The system
 * prompt becomes systemInstruction, user parts become contents, tool definitions
 * become functionDeclarations, and the cap, stops, JSON mode and sampling become
 * generationConfig. Tool and assistant turns carry nothing the echo reads.
 */
export function openAIToGeminiBody(body: Json, _model: string): Json {
  const system = openAISystemText(body);
  const contents: Json[] = [];
  const source = Array.isArray(body.messages) ? body.messages : [];
  for (const raw of source) {
    if (!isRecord(raw)) continue;
    if (raw.role === 'system' || raw.role === 'tool') continue;
    if (raw.role === 'assistant') {
      const text = textOf(raw.content);
      if (text !== '') contents.push({ role: 'model', parts: [{ text }] });
      continue;
    }
    const parts = openAIContentToGeminiParts(raw.content);
    if (parts.length > 0) contents.push({ role: 'user', parts });
  }
  const out: Json = { contents };
  if (system !== '') out.systemInstruction = { parts: [{ text: system }] };
  if (Array.isArray(body.tools)) {
    const declarations = body.tools.flatMap((raw) => {
      if (!isRecord(raw) || !isRecord(raw.function) || typeof raw.function.name !== 'string') return [];
      return [
        {
          name: raw.function.name,
          description: typeof raw.function.description === 'string' ? raw.function.description : '',
          parameters: isRecord(raw.function.parameters) ? raw.function.parameters : { type: 'object', properties: {} },
        },
      ];
    });
    if (declarations.length > 0) out.tools = [{ functionDeclarations: declarations }];
  }
  const jsonMode = isRecord(body.response_format) && (body.response_format.type === 'json_object' || body.response_format.type === 'json_schema');
  const config = geminiConfig(body, jsonMode);
  if (Object.keys(config).length > 0) out.generationConfig = config;
  return out;
}

/**
 * An Anthropic Messages request as a Gemini generateContent body. Anthropic carries
 * no JSON mode, so responseMimeType is never set here.
 */
export function anthropicToGeminiBody(body: Json, _model: string): Json {
  const system = textOf(body.system);
  const contents: Json[] = [];
  const source = Array.isArray(body.messages) ? body.messages : [];
  for (const raw of source) {
    if (!isRecord(raw)) continue;
    if (raw.role === 'assistant') {
      const text = textOf(raw.content);
      if (text !== '') contents.push({ role: 'model', parts: [{ text }] });
      continue;
    }
    if (raw.role !== 'user') continue;
    const parts = anthropicContentToGeminiParts(raw.content);
    if (parts.length > 0) contents.push({ role: 'user', parts });
  }
  const out: Json = { contents };
  if (system !== '') out.systemInstruction = { parts: [{ text: system }] };
  if (Array.isArray(body.tools)) {
    const declarations = body.tools.flatMap((raw) => {
      if (!isRecord(raw) || typeof raw.name !== 'string') return [];
      return [
        {
          name: raw.name,
          description: typeof raw.description === 'string' ? raw.description : '',
          parameters: isRecord(raw.input_schema) ? raw.input_schema : { type: 'object', properties: {} },
        },
      ];
    });
    if (declarations.length > 0) out.tools = [{ functionDeclarations: declarations }];
  }
  const config = geminiConfig(body, false);
  if (Object.keys(config).length > 0) out.generationConfig = config;
  return out;
}

/** One SSE frame's lines as { event, data }: the frames of one streamed answer. */
function parseSseFrames(text: string): { event: string | null; data: string }[] {
  const frames: { event: string | null; data: string }[] = [];
  const normalized = text.replace(/\r\n/g, '\n');
  for (const frame of normalized.split('\n\n')) {
    if (frame.trim() === '') continue;
    let event: string | null = null;
    const data: string[] = [];
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
      else if (line.startsWith('data:')) data.push(line.slice('data:'.length).replace(/^ /, ''));
    }
    if (data.length > 0) frames.push({ event, data: data.join('\n') });
  }
  return frames;
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** The text of a Chat Completions message: a string, or its text blocks joined. */
function messageText(message: Json): string {
  if (typeof message.content === 'string') return message.content;
  return textOf(message.content);
}

/** Collect an OpenAI-wire provider's answer, JSON or streamed, into one answer. */
export async function collectOpenAIAnswer(res: Response, stream: boolean): Promise<UpstreamAnswer> {
  if (!stream) {
    const body: unknown = await res.json();
    const value = isRecord(body) ? body : {};
    const choices = Array.isArray(value.choices) ? value.choices : [];
    const choice = isRecord(choices[0]) ? choices[0] : {};
    const message = isRecord(choice.message) ? choice.message : {};
    const usage = isRecord(value.usage) ? value.usage : {};
    return {
      text: messageText(message),
      usage: { input: numberOrZero(usage.prompt_tokens), output: numberOrZero(usage.completion_tokens) },
      stop: typeof choice.finish_reason === 'string' ? choice.finish_reason : 'stop',
    };
  }
  const text = await res.text();
  let answer = '';
  let usage = { input: 0, output: 0 };
  let stop = 'stop';
  for (const frame of parseSseFrames(text)) {
    const payload = frame.data.trim();
    if (payload === '[DONE]') continue;
    let chunk: unknown;
    try {
      chunk = JSON.parse(payload);
    } catch {
      continue;
    }
    if (!isRecord(chunk)) continue;
    if (isRecord(chunk.usage)) usage = { input: numberOrZero(chunk.usage.prompt_tokens), output: numberOrZero(chunk.usage.completion_tokens) };
    const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
    if (choices.length === 0) continue;
    const choice = isRecord(choices[0]) ? choices[0] : null;
    if (choice === null) continue;
    const delta = isRecord(choice.delta) ? choice.delta : {};
    if (typeof delta.content === 'string') answer += delta.content;
    if (typeof choice.finish_reason === 'string') stop = choice.finish_reason;
  }
  return { text: answer, usage, stop };
}

/** Collect an Anthropic-wire provider's answer, JSON or streamed, into one answer. */
export async function collectAnthropicAnswer(res: Response, stream: boolean): Promise<UpstreamAnswer> {
  if (!stream) {
    const body: unknown = await res.json();
    const value = isRecord(body) ? body : {};
    const usage = isRecord(value.usage) ? value.usage : {};
    return {
      text: textOf(value.content),
      usage: { input: numberOrZero(usage.input_tokens), output: numberOrZero(usage.output_tokens) },
      stop: typeof value.stop_reason === 'string' ? value.stop_reason : 'end_turn',
    };
  }
  const text = await res.text();
  let answer = '';
  let input = 0;
  let output = 0;
  let stop = 'end_turn';
  for (const frame of parseSseFrames(text)) {
    let data: unknown;
    try {
      data = JSON.parse(frame.data);
    } catch {
      continue;
    }
    if (!isRecord(data)) continue;
    if (frame.event === 'message_start' && isRecord(data.message) && isRecord(data.message.usage)) {
      input = numberOrZero(data.message.usage.input_tokens);
    } else if (frame.event === 'content_block_delta' && isRecord(data.delta) && data.delta.type === 'text_delta' && typeof data.delta.text === 'string') {
      answer += data.delta.text;
    } else if (frame.event === 'message_delta') {
      if (isRecord(data.delta) && typeof data.delta.stop_reason === 'string') stop = data.delta.stop_reason;
      if (isRecord(data.usage)) output = numberOrZero(data.usage.output_tokens);
    }
  }
  return { text: answer, usage: { input, output }, stop };
}

/** Collect a Gemini-wire provider's answer, JSON or streamed, into one answer. */
export async function collectGeminiAnswer(res: Response, stream: boolean): Promise<UpstreamAnswer> {
  if (!stream) {
    const body: unknown = await res.json();
    const value = isRecord(body) ? body : {};
    const candidates = Array.isArray(value.candidates) ? value.candidates : [];
    const candidate = isRecord(candidates[0]) ? candidates[0] : {};
    const content = isRecord(candidate.content) ? candidate.content : {};
    const parts = Array.isArray(content.parts) ? content.parts : [];
    const text = parts.flatMap((p) => (isRecord(p) && typeof p.text === 'string' ? [p.text] : [])).join('');
    const usage = isRecord(value.usageMetadata) ? value.usageMetadata : {};
    return {
      text,
      usage: { input: numberOrZero(usage.promptTokenCount), output: numberOrZero(usage.candidatesTokenCount) },
      stop: typeof candidate.finishReason === 'string' ? candidate.finishReason : 'STOP',
    };
  }
  const text = await res.text();
  let answer = '';
  let usage = { input: 0, output: 0 };
  let stop = 'STOP';
  for (const frame of parseSseFrames(text)) {
    let data: unknown;
    try {
      data = JSON.parse(frame.data);
    } catch {
      continue;
    }
    if (!isRecord(data)) continue;
    const candidates = Array.isArray(data.candidates) ? data.candidates : [];
    const candidate = isRecord(candidates[0]) ? candidates[0] : null;
    if (candidate !== null) {
      const content = isRecord(candidate.content) ? candidate.content : {};
      const parts = Array.isArray(content.parts) ? content.parts : [];
      for (const part of parts) if (isRecord(part) && typeof part.text === 'string') answer += part.text;
      if (typeof candidate.finishReason === 'string') stop = candidate.finishReason;
    }
    if (isRecord(data.usageMetadata)) {
      usage = { input: numberOrZero(data.usageMetadata.promptTokenCount), output: numberOrZero(data.usageMetadata.candidatesTokenCount) };
    }
  }
  return { text: answer, usage, stop };
}

/**
 * The usage a provider would report for a request, from the client's own body and
 * the answer's length: the same count the provider computes from the request it
 * parsed. Used only when a provider's answer carries no usage of its own.
 */
export function fallbackUsage(clientWire: 'openai' | 'anthropic', body: Json, answerText: string): { input: number; output: number } {
  let systemText = '';
  let userText = '';
  let tools: string[] = [];
  if (clientWire === 'openai') {
    systemText = openAISystemText(body);
    const messages = Array.isArray(body.messages) ? body.messages : [];
    for (const message of messages) {
      if (isRecord(message) && message.role === 'user') userText = textOf(message.content);
    }
    tools = openAIToolNames(body);
  } else {
    systemText = textOf(body.system);
    const messages = Array.isArray(body.messages) ? body.messages : [];
    for (const message of messages) {
      if (isRecord(message) && message.role === 'user') userText = textOf(message.content);
    }
    tools = anthropicToolNames(body);
  }
  const prompt = systemText.length + userText.length + tools.join(',').length;
  return { input: 1 + Math.floor(prompt / 4), output: 1 + Math.floor(answerText.length / 4) };
}

/** The stop-reason family: 0 end, 1 length, 2 tool call, 3 refusal. */
function stopFamily(stop: string): number {
  if (stop === 'stop' || stop === 'end_turn' || stop === 'STOP') return 0;
  if (stop === 'length' || stop === 'max_tokens' || stop === 'MAX_TOKENS') return 1;
  if (stop === 'tool_calls' || stop === 'function_call' || stop === 'tool_use') return 2;
  if (stop === 'content_filter' || stop === 'refusal' || stop === 'SAFETY') return 3;
  return 0;
}

/** A provider's stop reason in the OpenAI wire's spelling. */
function openAIStop(stop: string): string {
  const family = stopFamily(stop);
  if (family === 1) return 'length';
  if (family === 2) return 'tool_calls';
  if (family === 3) return 'content_filter';
  return 'stop';
}

/** A provider's stop reason in the Anthropic wire's spelling. */
function anthropicStop(stop: string): string {
  const family = stopFamily(stop);
  if (family === 1) return 'max_tokens';
  if (family === 2) return 'tool_use';
  if (family === 3) return 'refusal';
  return 'end_turn';
}

/** The text split the way the providers split streamed text: 13 characters a piece. */
function splitText(text: string): string[] {
  const pieces: string[] = [];
  for (let at = 0; at < text.length; at += SSE_DELTA_CHARS) pieces.push(text.slice(at, at + SSE_DELTA_CHARS));
  return pieces.length === 0 ? [''] : pieces;
}

function sendSseHead(res: ServerResponse): void {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
}

/** One provider answer as an OpenAI Chat Completions answer, JSON or streamed. */
export function renderOpenAI(res: ServerResponse, answer: UpstreamAnswer, model: string, stream: boolean): void {
  const stop = openAIStop(answer.stop);
  if (!stream) {
    const text = JSON.stringify({
      id: 'chatcmpl-sim',
      object: 'chat.completion',
      created: FIXED_CREATED,
      model,
      choices: [{ index: 0, message: { role: 'assistant', content: answer.text }, finish_reason: stop, logprobs: null }],
      usage: { prompt_tokens: answer.usage.input, completion_tokens: answer.usage.output, total_tokens: answer.usage.input + answer.usage.output },
    });
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
    res.end(text);
    return;
  }
  sendSseHead(res);
  const chunk = (delta: Json, finish: string | null): string =>
    `data: ${JSON.stringify({ id: 'chatcmpl-sim', object: 'chat.completion.chunk', created: FIXED_CREATED, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  res.write(chunk({ role: 'assistant', content: '' }, null));
  for (const piece of splitText(answer.text)) res.write(chunk({ content: piece }, null));
  res.write(chunk({}, stop));
  res.write(
    `data: ${JSON.stringify({ id: 'chatcmpl-sim', object: 'chat.completion.chunk', created: FIXED_CREATED, model, choices: [], usage: { prompt_tokens: answer.usage.input, completion_tokens: answer.usage.output, total_tokens: answer.usage.input + answer.usage.output } })}\n\n`,
  );
  res.write('data: [DONE]\n\n');
  res.end();
}

/** One server-sent event: `event: <name>` when named, then the JSON data line, then the blank line. */
function sseEvent(event: string | null, data: unknown): string {
  return `${event === null ? '' : `event: ${event}\n`}data: ${JSON.stringify(data)}\n\n`;
}

/** One provider answer as an Anthropic Messages answer, JSON or streamed. */
export function renderAnthropic(res: ServerResponse, answer: UpstreamAnswer, model: string, stream: boolean): void {
  const stop = anthropicStop(answer.stop);
  if (!stream) {
    const text = JSON.stringify({
      id: 'msg_aggregate',
      type: 'message',
      role: 'assistant',
      model,
      content: [{ type: 'text', text: answer.text }],
      stop_reason: stop,
      stop_sequence: null,
      usage: { input_tokens: answer.usage.input, output_tokens: answer.usage.output },
    });
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
    res.end(text);
    return;
  }
  sendSseHead(res);
  res.write(
    sseEvent('message_start', {
      type: 'message_start',
      message: {
        id: 'msg_stream',
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: answer.usage.input, output_tokens: 0 },
      },
    }),
  );
  res.write(sseEvent('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }));
  for (const piece of splitText(answer.text)) {
    res.write(sseEvent('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: piece } }));
  }
  res.write(sseEvent('content_block_stop', { type: 'content_block_stop', index: 0 }));
  res.write(
    sseEvent('message_delta', { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: answer.usage.output } }),
  );
  res.write(sseEvent('message_stop', { type: 'message_stop' }));
  res.end();
}
