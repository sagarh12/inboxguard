import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { startProxy } from '../src/server.js';
import { parseConfig } from '../src/config.js';

const mockPath = fileURLToPath(new URL('../../../scripts/mock-upstream.js', import.meta.url));
const workDir = mkdtempSync(join(tmpdir(), 'inboxguard-proxy-'));
const harnesses = [];

after(async () => {
  for (const harness of harnesses) await harness.close();
  rmSync(workDir, { recursive: true, force: true });
});

async function startHarness({ limits = {}, name = `h${harnesses.length}` } = {}) {
  const callLog = join(workDir, `${name}-calls.jsonl`);
  const auditLog = join(workDir, `${name}-audit.jsonl`);
  const config = parseConfig(
    {
      upstreams: {
        mail: { command: process.execPath, args: [mockPath], env: { MOCK_UPSTREAM_LOG: callLog } },
      },
      auditLogPath: auditLog,
      limits: { upstreamTimeoutMs: 1500, maxResultBytes: 400000, ...limits },
      approval: { openBrowser: false },
    },
    workDir,
  );
  const clock = { offset: 0 };
  const logs = [];
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const proxy = await startProxy({
    config,
    transport: serverSide,
    log: (line) => logs.push(line),
    now: () => Date.now() + clock.offset,
  });
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(clientSide);
  const harness = {
    client,
    proxy,
    clock,
    logs,
    call: (tool, args = {}) => client.callTool({ name: tool, arguments: args }),
    forwarded: () =>
      existsSync(callLog)
        ? readFileSync(callLog, 'utf8')
            .trim()
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line))
        : [],
    audit: () => (existsSync(auditLog) ? readFileSync(auditLog, 'utf8') : ''),
    lastApprovalUrl: () => {
      const line = [...logs].reverse().find((l) => l.includes('/approval/'));
      return line ? new URL(line.slice(line.indexOf('http://'))) : null;
    },
    close: async () => {
      await client.close().catch(() => {});
      await proxy.close();
    },
  };
  harnesses.push(harness);
  return harness;
}

const textOf = (result) => result.content.map((c) => c.text ?? '').join('\n');

function rawHttp(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function loadApproval(url) {
  const page = await rawHttp(url);
  assert.equal(page.status, 200);
  const json = /<script id="approval-data" type="application\/json">([^<]*)<\/script>/.exec(
    page.body,
  )[1];
  return { page, data: JSON.parse(json) };
}

async function decide(url, decision, overrides = {}) {
  const { data } = await loadApproval(url);
  const headers = {
    'Content-Type': 'application/json',
    Origin: url.origin,
    'X-Inboxguard-CSRF': data.csrf,
    ...overrides.headers,
  };
  return rawHttp(`${url.origin}${url.pathname}/decision`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ decision, csrf: overrides.csrf ?? data.csrf }),
  });
}

test('re-exposes upstream tools with the same names and schemas', async () => {
  const h = await startHarness();
  const { tools } = await h.client.listTools();
  const names = tools.map((t) => t.name);
  assert.ok(names.includes('get_message') && names.includes('send_payment'));
  const payment = tools.find((t) => t.name === 'send_payment');
  assert.deepEqual(payment.inputSchema.required, ['iban', 'amount']);
});

test('poisoned email arrives sanitized, sender and subject kept', async () => {
  const h = await startHarness();
  const result = await h.call('get_message', { id: 'm2' });
  const text = textOf(result);
  const message = JSON.parse(text);
  const body = Buffer.from(message.payload.parts[0].body.data, 'base64url').toString('utf8');
  assert.match(body, /hidden instructions aimed at an AI assistant were found/);
  assert.ok(!/ignore previous instructions/i.test(text + body));
  assert.ok(!body.includes('GB82WEST'));
  assert.equal(message.id, 'm2');
  assert.ok(message.payload.headers.some((h2) => h2.value === 'Invoice INV-20431'));
  assert.ok(
    message.payload.headers.some((h2) => h2.value.includes('billing@northwind.example.org')),
  );
});

test('clean email is wrapped in a per-call delimiter', async () => {
  const h = await startHarness();
  const message = JSON.parse(textOf(await h.call('get_message', { id: 'm1' })));
  const body = Buffer.from(message.payload.parts[0].body.data, 'base64url').toString('utf8');
  assert.match(body, /^<untrusted_email id="[0-9a-f]{16}">\n/);
  assert.match(body, /free for lunch on Thursday/);
  assert.ok(!body.includes('<p>'));
});

test('unicode tag smuggling and resources are sanitized', async () => {
  const h = await startHarness();
  const message = JSON.parse(textOf(await h.call('get_message', { id: 'm4' })));
  const body = Buffer.from(message.payload.parts[0].body.data, 'base64url').toString('utf8');
  assert.match(body, /hidden instructions/);
  const resource = await h.client.readResource({ uri: 'mail://m2' });
  assert.match(resource.contents[0].text, /hidden instructions aimed at an AI assistant/);
  assert.ok(!resource.contents[0].text.includes('ignore previous'));
});

test('send_payment never reaches upstream before approval, then exactly once', async () => {
  const h = await startHarness();
  const args = { payee: 'Northwind', iban: 'GB82WEST12345698765432', amount: '$4,800.00' };
  const first = await h.call('send_payment', args);
  assert.equal(first.isError, true);
  assert.match(textOf(first), /Human approval is required/);
  assert.ok(!textOf(first).includes('http://'));
  assert.equal(h.forwarded().length, 0);

  const url = h.lastApprovalUrl();
  const { data, page } = await loadApproval(url);
  assert.equal(data.tool, 'send_payment');
  assert.ok(data.accounts.some((a) => a.value === 'GB82WEST12345698765432'));
  assert.match(page.headers['content-security-policy'], /script-src 'nonce-/);
  assert.equal((await decide(url, 'approve')).status, 200);
  assert.equal(h.forwarded().length, 0);

  const second = await h.call('send_payment', args);
  assert.match(textOf(second), /payment of \$4,800.00 sent/);
  assert.equal(h.forwarded().length, 1);

  const replay = await h.call('send_payment', args);
  assert.match(textOf(replay), /Human approval is required/);
  assert.equal(h.forwarded().length, 1);
});

test('approval is bound to the exact arguments', async () => {
  const h = await startHarness();
  await h.call('send_payment', { iban: 'GB82WEST12345698765432', amount: '$100' });
  assert.equal((await decide(h.lastApprovalUrl(), 'approve')).status, 200);
  const changed = await h.call('send_payment', { iban: 'GB82WEST12345698765432', amount: '$101' });
  assert.match(textOf(changed), /Human approval is required/);
  assert.equal(h.forwarded().length, 0);
  const reordered = await h.call('send_payment', {
    amount: '$100',
    iban: 'GB82WEST12345698765432',
  });
  assert.match(textOf(reordered), /payment of \$100 sent/);
  assert.equal(h.forwarded().length, 1);
});

test('rejection forwards nothing', async () => {
  const h = await startHarness();
  const args = { iban: 'GB82WEST12345698765432', amount: '$50' };
  await h.call('send_payment', args);
  assert.equal((await decide(h.lastApprovalUrl(), 'reject')).status, 200);
  const result = await h.call('send_payment', args);
  assert.match(textOf(result), /Rejected by user/);
  assert.equal(h.forwarded().length, 0);
});

test('expiry forwards nothing, even if approved late', async () => {
  const h = await startHarness();
  const args = { iban: 'GB82WEST12345698765432', amount: '$70' };
  await h.call('send_payment', args);
  const url = h.lastApprovalUrl();
  h.clock.offset = 6 * 60 * 1000;
  assert.equal((await decide(url, 'approve')).status, 409);
  const result = await h.call('send_payment', args);
  assert.match(textOf(result), /Rejected by user/);
  assert.equal(h.forwarded().length, 0);
});

test('approved but unused approval expires', async () => {
  const h = await startHarness();
  const args = { iban: 'GB82WEST12345698765432', amount: '$80' };
  await h.call('send_payment', args);
  assert.equal((await decide(h.lastApprovalUrl(), 'approve')).status, 200);
  h.clock.offset = 6 * 60 * 1000;
  assert.match(textOf(await h.call('send_payment', args)), /Rejected by user/);
  assert.equal(h.forwarded().length, 0);
});

test('mail rules are denied outright', async () => {
  const h = await startHarness();
  const result = await h.call('create_filter', { forward: 'x@example.net' });
  assert.match(textOf(result), /Blocked by inboxguard policy \(mail-rules\)/);
  assert.equal(h.forwarded().length, 0);
});

test('approval flooding is capped and duplicates collapse', async () => {
  const h = await startHarness({ limits: { maxPendingApprovals: 3 } });
  for (let i = 0; i < 3; i += 1)
    await h.call('send_payment', { iban: 'GB82WEST12345698765432', amount: `$${i}` });
  await h.call('send_payment', { iban: 'GB82WEST12345698765432', amount: '$0' });
  assert.equal(h.proxy.store.pending().length, 3);
  const flooded = await h.call('send_payment', { iban: 'GB82WEST12345698765432', amount: '$999' });
  assert.match(textOf(flooded), /Too many actions/);
  assert.equal(h.logs.filter((l) => l.includes('/approval/')).length, 3);
  assert.equal(h.forwarded().length, 0);
});

test('approval page rejects bad host, token, origin and csrf', async () => {
  const h = await startHarness();
  await h.call('send_payment', { iban: 'GB82WEST12345698765432', amount: '$5' });
  const url = h.lastApprovalUrl();
  assert.equal((await rawHttp(url, { headers: { Host: 'evil.example.com' } })).status, 403);
  const badToken = new URL(url);
  badToken.searchParams.set('token', 'wrong');
  assert.equal((await rawHttp(badToken)).status, 403);
  assert.equal(
    (await decide(url, 'approve', { headers: { Origin: 'http://evil.example.com' } })).status,
    403,
  );
  assert.equal(
    (await decide(url, 'approve', { headers: { 'X-Inboxguard-CSRF': 'nope' } })).status,
    403,
  );
  assert.equal((await decide(url, 'approve', { csrf: 'nope' })).status, 403);
  assert.equal(h.proxy.store.pending().length, 1);
});

test('session taint is applied after a flagged read', async () => {
  const h = await startHarness();
  await h.call('get_message', { id: 'm2' });
  assert.equal(h.proxy.session.tainted, true);
  const result = await h.call('send_email', { to: 'team@example.com', body: 'hello' });
  assert.match(textOf(result), /already read content judged suspicious or malicious/);
});

test('upstream timeout, malformed output and oversized results fail cleanly', async () => {
  const h = await startHarness();
  const started = Date.now();
  const slow = await h.call('get_slow_message');
  assert.ok(Date.now() - started < 5000);
  assert.match(textOf(slow), /did not return a usable result \(timeout\)/);
  const malformed = await h.call('get_malformed_message');
  assert.equal(malformed.isError, true);
  assert.match(textOf(malformed), /did not return a usable result/);
  const huge = await h.call('get_huge_message');
  const hugeText = textOf(huge);
  assert.match(hugeText, /larger than the limit and was truncated/);
  assert.ok(Buffer.byteLength(JSON.stringify(huge)) < 600000);
});

test('upstream crash gives a clean error and no hang', async () => {
  const h = await startHarness();
  await h.call('send_email', { to: 'x@example.net' });
  const crash = await h.call('get_crash_message');
  assert.equal(crash.isError, true);
  const afterCrash = await h.call('list_messages');
  assert.equal(afterCrash.isError, true);
  assert.match(textOf(afterCrash), /did not return a usable result/);
});

test('audit log has one line per call and no email bodies or payment data', async () => {
  const h = await startHarness();
  await h.call('get_message', { id: 'm2' });
  await h.call('send_payment', { iban: 'GB82WEST12345698765432', amount: '$1' });
  const lines = h
    .audit()
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(lines.length, 2);
  assert.deepEqual(Object.keys(lines[0]).sort(), [
    'category',
    'decision',
    'findingKinds',
    'outcome',
    'time',
    'tool',
    'upstream',
    'verdict',
  ]);
  const raw = h.audit();
  for (const secret of ['ignore previous', 'GB82WEST', 'INV-20431', '$1'])
    assert.ok(!raw.includes(secret), secret);
});
