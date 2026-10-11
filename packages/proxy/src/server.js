#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  McpError,
  ErrorCode,
} from '@modelcontextprotocol/sdk/types.js';
import { evaluateAction, redactArguments } from '@inboxguard/core';
import { loadConfig, ConfigError, describeUpstream } from './config.js';
import * as upstreamClient from './upstream.js';
import { sanitizeToolResult, sanitizeResourceResult, sanitizePromptResult } from './sanitize.js';
import { createApprovalStore } from './approvals.js';
import { createApprovalPage, openInBrowser } from './approval-page.js';
import { createAuditLog } from './audit.js';

const SERVER_INFO = { name: 'inboxguard', version: '0.1.0' };

function textResult(text, isError = true) {
  return { content: [{ type: 'text', text }], isError };
}

const RESULTS = {
  denied: (evaluation) =>
    textResult(
      `Blocked by inboxguard policy (${evaluation.category}). This action is not allowed through an AI assistant and was not run. Reasons: ${evaluation.reasons.join('; ')}`,
    ),
  approvalRequired: (evaluation) =>
    textResult(
      `Human approval is required before this action can run. The user has been notified outside this conversation. Nothing was sent or changed. Do not retry this call until the user confirms they approved it. Reasons: ${evaluation.reasons.join('; ')}`,
    ),
  flooded: () =>
    textResult(
      'Too many actions are already waiting for human approval. This action was not run and the user was not asked again. Ask the user to review the pending approvals first.',
    ),
  rejected: () => textResult('Rejected by user. The action was not run.'),
  upstreamFailed: (kind) =>
    textResult(
      `inboxguard: the upstream server did not return a usable result (${kind}). Nothing from it was passed on.`,
    ),
  unknownTool: (name) => textResult(`inboxguard: unknown tool ${name}.`),
};

function buildDisplay(tool, args, evaluation) {
  const details = evaluation.details;
  return {
    category: evaluation.category,
    fields: details.fields,
    accounts: details.accounts,
    amounts: details.amounts,
    cardNumbers: details.cardNumbers,
    externalRecipients: details.externalRecipients,
    payeeFlags: evaluation.reasons.filter((reason) => reason.startsWith('WARNING')),
    reasons: evaluation.reasons.filter((reason) => !reason.startsWith('WARNING')),
    rawArguments: JSON.stringify(redactArguments(args ?? {}), null, 2).slice(0, 20000),
  };
}

function exposeTools(listings) {
  const counts = new Map();
  for (const { tools } of listings)
    for (const tool of tools) counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
  const map = new Map();
  for (const { upstream, tools } of listings) {
    for (const tool of tools) {
      const exposed = counts.get(tool.name) > 1 ? `${upstream.name}__${tool.name}` : tool.name;
      map.set(exposed, { upstream, name: tool.name, tool: { ...tool, name: exposed } });
    }
  }
  return map;
}

export async function startProxy({
  config,
  transport,
  openUrl = openInBrowser,
  log = (line) => process.stderr.write(`${line}\n`),
  now,
}) {
  const limits = config.limits;
  const requestOptions = (signal) => ({ timeoutMs: limits.upstreamTimeoutMs, signal });
  const sanitizeOptions = { limits };
  const upstreams = [];
  for (const [name, spec] of Object.entries(config.upstreams)) {
    log(`inboxguard: connecting upstream ${name} (${describeUpstream(spec)})`);
    upstreams.push(
      await upstreamClient.connectUpstream(name, spec, { timeoutMs: limits.upstreamTimeoutMs }),
    );
  }
  const session = { tainted: false, reasons: [] };
  const audit = createAuditLog({
    path: config.auditLogPath,
    maxBytes: config.auditMaxBytes,
    keep: config.auditKeepFiles,
    onError: (error) => log(`inboxguard: audit log write failed (${error.code ?? error.name})`),
  });
  const store = createApprovalStore({
    ttlMs: limits.approvalTtlMs,
    maxPending: limits.maxPendingApprovals,
    now,
  });
  const page = createApprovalPage({
    store,
    onDecision: (approval) =>
      audit.record({
        tool: approval.tool,
        decision: approval.status,
        outcome: `human ${approval.status}`,
        approvalId: approval.id,
      }),
  });
  const resourceOwners = new Map();
  let toolMap = new Map();

  const withCapability = (capability) =>
    upstreams.filter((u) => u.alive && u.capabilities[capability]);

  async function refreshTools(signal) {
    const listings = [];
    for (const upstream of withCapability('tools')) {
      listings.push({
        upstream,
        tools: await upstreamClient.listTools(upstream, requestOptions(signal)),
      });
    }
    toolMap = exposeTools(listings);
    return toolMap;
  }

  function taint(source, verdict) {
    if (verdict === 'clean') return;
    session.tainted = true;
    session.reasons.push(`${source} returned ${verdict} content`);
  }

  async function approvalFlow(toolName, args, evaluation) {
    const existing = store.lookup(toolName, args);
    if (existing?.status === 'approved') {
      store.consume(existing);
      return { forward: true, outcome: 'forwarded after approval', approvalId: existing.id };
    }
    if (existing?.status === 'rejected' || existing?.status === 'expired') {
      store.settle(existing);
      return {
        result: RESULTS.rejected(),
        outcome: `not run (${existing.status})`,
        approvalId: existing.id,
      };
    }
    const requested = store.request({
      tool: toolName,
      args,
      display: buildDisplay(toolName, args, evaluation),
    });
    if (requested.status === 'flooded')
      return { result: RESULTS.flooded(), outcome: 'not run (too many pending)' };
    if (requested.status === 'created') {
      await page.ensureStarted();
      const url = page.urlFor(requested.approval);
      log(`inboxguard: approval needed for ${toolName}. Open ${url}`);
      if (config.approval.openBrowser) openUrl(url);
    }
    return {
      result: RESULTS.approvalRequired(evaluation),
      outcome: 'waiting for approval',
      approvalId: requested.approval.id,
    };
  }

  async function forwardTool(entry, args, signal) {
    try {
      const raw = await upstreamClient.callTool(
        entry.upstream,
        entry.name,
        args,
        requestOptions(signal),
      );
      const sanitized = sanitizeToolResult(raw, sanitizeOptions);
      taint(entry.tool.name, sanitized.verdict);
      return sanitized;
    } catch (error) {
      const kind = error instanceof upstreamClient.UpstreamError ? error.kind : 'failed';
      return {
        result: RESULTS.upstreamFailed(kind),
        verdict: 'none',
        findingKinds: [`upstream-${kind}`],
      };
    }
  }

  async function handleCallTool(request, extra) {
    const name = request.params.name;
    const args = request.params.arguments ?? {};
    const entry = toolMap.get(name) ?? (await refreshTools(extra.signal)).get(name);
    if (!entry) return RESULTS.unknownTool(name);
    const evaluation = evaluateAction({ tool: entry.name, args, session }, config.policy);
    const base = {
      tool: name,
      upstream: entry.upstream.name,
      decision: evaluation.decision,
      category: evaluation.category,
    };
    if (evaluation.decision === 'deny') {
      audit.record({ ...base, outcome: 'denied' });
      return RESULTS.denied(evaluation);
    }
    if (evaluation.decision === 'approve') {
      const flow = await approvalFlow(name, args, evaluation);
      if (!flow.forward) {
        audit.record({ ...base, outcome: flow.outcome, approvalId: flow.approvalId });
        return flow.result;
      }
      const forwarded = await forwardTool(entry, args, extra.signal);
      audit.record({
        ...base,
        outcome: flow.outcome,
        approvalId: flow.approvalId,
        verdict: forwarded.verdict,
        findingKinds: forwarded.findingKinds,
      });
      return forwarded.result;
    }
    const forwarded = await forwardTool(entry, args, extra.signal);
    audit.record({
      ...base,
      outcome: 'forwarded',
      verdict: forwarded.verdict,
      findingKinds: forwarded.findingKinds,
    });
    return forwarded.result;
  }

  async function handleListResources(extra) {
    const resources = [];
    for (const upstream of withCapability('resources')) {
      for (const resource of await upstreamClient.listResources(
        upstream,
        requestOptions(extra.signal),
      )) {
        resourceOwners.set(resource.uri, upstream);
        resources.push(resource);
      }
    }
    return { resources };
  }

  async function handleReadResource(request, extra) {
    const uri = request.params.uri;
    const candidates = resourceOwners.has(uri)
      ? [resourceOwners.get(uri)]
      : withCapability('resources');
    for (const upstream of candidates) {
      try {
        const raw = await upstreamClient.readResource(upstream, uri, requestOptions(extra.signal));
        const sanitized = sanitizeResourceResult(raw, sanitizeOptions);
        taint(`resource ${uri}`, sanitized.verdict);
        audit.record({
          tool: 'resources/read',
          upstream: upstream.name,
          decision: 'allow',
          verdict: sanitized.verdict,
          findingKinds: sanitized.findingKinds,
          outcome: 'forwarded',
        });
        return sanitized.result;
      } catch {
        continue;
      }
    }
    throw new McpError(
      ErrorCode.InvalidParams,
      'inboxguard: resource could not be read from any upstream',
    );
  }

  async function handleGetPrompt(request, extra) {
    for (const upstream of withCapability('prompts')) {
      const prompts = await upstreamClient.listPrompts(upstream, requestOptions(extra.signal));
      if (!prompts.some((p) => p.name === request.params.name)) continue;
      try {
        const raw = await upstreamClient.getPrompt(
          upstream,
          request.params.name,
          request.params.arguments,
          requestOptions(extra.signal),
        );
        const sanitized = sanitizePromptResult(raw, sanitizeOptions);
        taint(`prompt ${request.params.name}`, sanitized.verdict);
        return sanitized.result;
      } catch (error) {
        throw new McpError(
          ErrorCode.InternalError,
          `inboxguard: prompt failed (${error.kind ?? 'failed'})`,
        );
      }
    }
    throw new McpError(ErrorCode.InvalidParams, 'inboxguard: unknown prompt');
  }

  const capabilities = { tools: {} };
  if (withCapability('resources').length > 0) capabilities.resources = {};
  if (withCapability('prompts').length > 0) capabilities.prompts = {};
  const server = new Server(SERVER_INFO, { capabilities });

  server.setRequestHandler(ListToolsRequestSchema, async (_request, extra) => ({
    tools: [...(await refreshTools(extra.signal)).values()].map((entry) => entry.tool),
  }));
  server.setRequestHandler(CallToolRequestSchema, handleCallTool);
  if (capabilities.resources) {
    server.setRequestHandler(ListResourcesRequestSchema, (_request, extra) =>
      handleListResources(extra),
    );
    server.setRequestHandler(ListResourceTemplatesRequestSchema, async (_request, extra) => {
      const resourceTemplates = [];
      for (const upstream of withCapability('resources')) {
        resourceTemplates.push(
          ...(await upstreamClient
            .listResourceTemplates(upstream, requestOptions(extra.signal))
            .catch(() => [])),
        );
      }
      return { resourceTemplates };
    });
    server.setRequestHandler(ReadResourceRequestSchema, handleReadResource);
  }
  if (capabilities.prompts) {
    server.setRequestHandler(ListPromptsRequestSchema, async (_request, extra) => {
      const prompts = [];
      for (const upstream of withCapability('prompts'))
        prompts.push(...(await upstreamClient.listPrompts(upstream, requestOptions(extra.signal))));
      return { prompts };
    });
    server.setRequestHandler(GetPromptRequestSchema, handleGetPrompt);
  }

  await refreshTools();
  await server.connect(transport);

  return {
    server,
    store,
    session,
    async close() {
      await server.close().catch(() => {});
      await page.close();
      for (const upstream of upstreams) await upstreamClient.closeUpstream(upstream);
    },
  };
}

function configPathFromArgs(argv) {
  const index = argv.indexOf('--config');
  if (index !== -1 && argv[index + 1]) return argv[index + 1];
  return process.env.INBOXGUARD_CONFIG ?? 'inboxguard.config.json';
}

async function main() {
  let config;
  try {
    config = loadConfig(configPathFromArgs(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(
      `inboxguard: ${error instanceof ConfigError ? error.message : 'failed to load config'}\n`,
    );
    process.exit(1);
  }
  try {
    const proxy = await startProxy({ config, transport: new StdioServerTransport() });
    const shutdown = async () => {
      await proxy.close();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.stdin.on('close', shutdown);
  } catch (error) {
    process.stderr.write(`inboxguard: ${error.message}\n`);
    process.exit(1);
  }
}

function isEntryPoint() {
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isEntryPoint()) main();
