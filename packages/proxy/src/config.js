import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { z } from 'zod';
import { DEFAULT_POLICY } from '@inboxguard/core';

const stdioUpstream = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
  cwd: z.string().optional(),
});

const httpUpstream = z.object({
  url: z.url(),
  headers: z.record(z.string(), z.string()).default({}),
});

const configSchema = z.object({
  upstreams: z
    .record(z.string().regex(/^[A-Za-z0-9_-]{1,40}$/), z.union([stdioUpstream, httpUpstream]))
    .refine((value) => Object.keys(value).length > 0, 'at least one upstream is required'),
  policyPath: z.string().optional(),
  payeesPath: z.string().optional(),
  auditLogPath: z.string().default('inboxguard-audit.jsonl'),
  auditMaxBytes: z
    .number()
    .int()
    .positive()
    .default(5 * 1024 * 1024),
  auditKeepFiles: z.number().int().min(1).max(20).default(3),
  limits: z
    .object({
      upstreamTimeoutMs: z.number().int().positive().default(30000),
      maxResultBytes: z
        .number()
        .int()
        .positive()
        .default(2 * 1024 * 1024),
      approvalTtlMs: z
        .number()
        .int()
        .positive()
        .default(5 * 60 * 1000),
      maxPendingApprovals: z.number().int().positive().default(20),
      inspectionTimeBudgetMs: z.number().int().positive().default(2000),
    })
    .prefault({}),
  approval: z
    .object({
      openBrowser: z.boolean().default(true),
    })
    .prefault({}),
});

export class ConfigError extends Error {}

function describeIssues(error) {
  return error.issues
    .map((issue) => `${issue.path.join('.') || 'config'}: ${issue.message}`)
    .join('; ');
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new ConfigError(`cannot read ${label} at ${path}: ${error.code ?? error.name}`);
  }
}

function resolveFrom(baseDir, path) {
  return isAbsolute(path) ? path : resolve(baseDir, path);
}

export function parseConfig(raw, baseDir = process.cwd()) {
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) throw new ConfigError(`invalid config: ${describeIssues(parsed.error)}`);
  const config = parsed.data;
  const policy = config.policyPath
    ? readJson(resolveFrom(baseDir, config.policyPath), 'policy')
    : structuredClone(DEFAULT_POLICY);
  const payees = config.payeesPath
    ? readJson(resolveFrom(baseDir, config.payeesPath), 'payees')
    : null;
  const upstreams = Object.fromEntries(
    Object.entries(config.upstreams).map(([name, spec]) => [
      name,
      spec.cwd ? { ...spec, cwd: resolveFrom(baseDir, spec.cwd) } : spec,
    ]),
  );
  return {
    ...config,
    upstreams,
    auditLogPath: resolveFrom(baseDir, config.auditLogPath),
    policy: { ...policy, payees },
  };
}

export function loadConfig(path) {
  const absolute = resolve(path);
  return parseConfig(readJson(absolute, 'config'), dirname(absolute));
}

export function describeUpstream(spec) {
  if (spec.url) return `url ${new URL(spec.url).origin}`;
  return `command ${spec.command}`;
}
