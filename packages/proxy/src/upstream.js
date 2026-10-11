import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  CallToolResultSchema,
  ListToolsResultSchema,
  ListResourcesResultSchema,
  ListResourceTemplatesResultSchema,
  ReadResourceResultSchema,
  ListPromptsResultSchema,
  GetPromptResultSchema,
} from '@modelcontextprotocol/sdk/types.js';

const CLIENT_INFO = { name: 'inboxguard-proxy', version: '0.1.0' };
const MAX_PAGES = 50;

export class UpstreamError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

function createTransport(spec) {
  if (spec.url) {
    return new StreamableHTTPClientTransport(new URL(spec.url), {
      requestInit: { headers: spec.headers ?? {} },
    });
  }
  return new StdioClientTransport({
    command: spec.command,
    args: spec.args ?? [],
    env: { ...getDefaultEnvironment(), ...(spec.env ?? {}) },
    cwd: spec.cwd,
    stderr: 'inherit',
  });
}

function classifyError(error) {
  const message = String(error?.message ?? '');
  if (error?.code === -32001 || /timed? ?out/i.test(message)) return 'timeout';
  if (error?.code === -32000 || /closed|EPIPE|ECONNRESET|not connected/i.test(message))
    return 'closed';
  if (error?.name === 'ZodError' || /invalid|parse|schema|expected/i.test(message))
    return 'malformed';
  return 'failed';
}

export async function connectUpstream(name, spec, { timeoutMs }) {
  const client = new Client(CLIENT_INFO, { capabilities: {} });
  const upstream = { name, client, alive: true, capabilities: {} };
  client.onclose = () => {
    upstream.alive = false;
  };
  client.onerror = () => {};
  try {
    await client.connect(createTransport(spec), { timeout: timeoutMs });
  } catch (error) {
    throw new UpstreamError(
      classifyError(error),
      `upstream ${name} did not start (${classifyError(error)})`,
    );
  }
  upstream.capabilities = client.getServerCapabilities() ?? {};
  return upstream;
}

async function request(upstream, method, params, schema, { timeoutMs, signal }) {
  if (!upstream.alive)
    throw new UpstreamError('closed', `upstream ${upstream.name} is not running`);
  try {
    return await upstream.client.request({ method, params }, schema, {
      timeout: timeoutMs,
      signal,
    });
  } catch (error) {
    throw new UpstreamError(
      classifyError(error),
      `upstream ${upstream.name} ${classifyError(error)}`,
    );
  }
}

async function listAll(upstream, method, schema, field, options) {
  const items = [];
  let cursor;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await request(upstream, method, cursor ? { cursor } : {}, schema, options);
    items.push(...(result[field] ?? []));
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  return items;
}

export function listTools(upstream, options) {
  return listAll(upstream, 'tools/list', ListToolsResultSchema, 'tools', options);
}

export function callTool(upstream, name, args, options) {
  return request(
    upstream,
    'tools/call',
    { name, arguments: args ?? {} },
    CallToolResultSchema,
    options,
  );
}

export function listResources(upstream, options) {
  return listAll(upstream, 'resources/list', ListResourcesResultSchema, 'resources', options);
}

export function listResourceTemplates(upstream, options) {
  return listAll(
    upstream,
    'resources/templates/list',
    ListResourceTemplatesResultSchema,
    'resourceTemplates',
    options,
  );
}

export function readResource(upstream, uri, options) {
  return request(upstream, 'resources/read', { uri }, ReadResourceResultSchema, options);
}

export function listPrompts(upstream, options) {
  return listAll(upstream, 'prompts/list', ListPromptsResultSchema, 'prompts', options);
}

export function getPrompt(upstream, name, args, options) {
  return request(
    upstream,
    'prompts/get',
    { name, arguments: args },
    GetPromptResultSchema,
    options,
  );
}

export async function closeUpstream(upstream) {
  try {
    await upstream.client.close();
  } catch {
    upstream.alive = false;
  }
}
