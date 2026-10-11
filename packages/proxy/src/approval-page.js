import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';

const MAX_BODY_BYTES = 4096;

function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ''));
  const right = Buffer.from(String(b ?? ''));
  return left.length === right.length && timingSafeEqual(left, right);
}

function jsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

function securityHeaders(nonce) {
  return {
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'`,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
}

const PAGE_STYLE = `
:root { color-scheme: light dark; --bg: #ffffff; --fg: #1a1a1a; --muted: #5c5c5c; --card: #f4f4f5; --warn: #b42318; --border: #d4d4d8; }
@media (prefers-color-scheme: dark) { :root { --bg: #18181b; --fg: #f4f4f5; --muted: #a1a1aa; --card: #27272a; --warn: #fca5a5; --border: #3f3f46; } }
body { font: 15px/1.5 system-ui, sans-serif; background: var(--bg); color: var(--fg); margin: 0; padding: 24px 16px; }
main { max-width: 760px; margin: 0 auto; }
h1 { font-size: 20px; margin: 0 0 4px; }
.muted { color: var(--muted); }
section { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 12px 16px; margin: 16px 0; }
h2 { font-size: 15px; margin: 0 0 8px; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 0; }
dt { color: var(--muted); }
dd { margin: 0; word-break: break-all; }
.warn { color: var(--warn); font-weight: 600; }
pre { white-space: pre-wrap; word-break: break-all; margin: 0; font-size: 13px; }
.actions { display: flex; gap: 12px; margin-top: 20px; }
button { font: inherit; padding: 10px 18px; border-radius: 6px; border: 1px solid var(--border); cursor: pointer; background: var(--bg); color: var(--fg); }
button.approve { background: #166534; color: #fff; border-color: #166534; }
button:focus-visible { outline: 3px solid #2563eb; outline-offset: 2px; }
#status { margin-top: 16px; font-weight: 600; }
`;

const PAGE_SCRIPT = `
const data = JSON.parse(document.getElementById('approval-data').textContent);
const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = String(text); if (className) node.className = className; return node; };
const addRow = (dl, label, value) => { dl.append(el('dt', label), el('dd', value)); };
document.getElementById('tool').textContent = data.tool;
document.getElementById('expires').textContent = new Date(data.expiresAt).toLocaleTimeString();
const facts = document.getElementById('facts');
addRow(facts, 'Tool', data.tool);
addRow(facts, 'Category', data.category);
const shown = new Set();
for (const field of data.fields) { addRow(facts, field.field, field.value); shown.add(field.value.replace(/\\s/g, '').toUpperCase()); }
for (const account of data.accounts) if (!shown.has(account.value.replace(/\\s/g, '').toUpperCase())) addRow(facts, account.type, account.value);
for (const amount of data.amounts) if (!shown.has(amount.replace(/\\s/g, '').toUpperCase())) addRow(facts, 'amount', amount);
if (data.cardNumbers > 0) addRow(facts, 'card numbers', data.cardNumbers + ' detected (not shown)');
if (data.externalRecipients.length > 0) addRow(facts, 'external recipients', data.externalRecipients.join(', '));
const warnings = document.getElementById('warnings');
for (const flag of data.payeeFlags) warnings.append(el('p', flag, 'warn'));
if (data.payeeFlags.length === 0) warnings.parentElement.hidden = true;
const reasons = document.getElementById('reasons');
for (const reason of data.reasons) reasons.append(el('li', reason));
document.getElementById('raw').textContent = data.rawArguments;
const status = document.getElementById('status');
async function decide(decision) {
  for (const button of document.querySelectorAll('button')) button.disabled = true;
  try {
    const response = await fetch(location.pathname + '/decision', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Inboxguard-CSRF': data.csrf }, body: JSON.stringify({ decision, csrf: data.csrf }) });
    const body = await response.json();
    status.textContent = response.ok ? (decision === 'approve' ? 'Approved. The assistant can now run this exact action once.' : 'Rejected. Nothing will happen.') : 'Not saved: ' + body.error;
  } catch (error) {
    status.textContent = 'Not saved: the proxy is not reachable.';
  }
}
document.getElementById('approve').addEventListener('click', () => decide('approve'));
document.getElementById('reject').addEventListener('click', () => decide('reject'));
`;

function renderPage(approval, nonce) {
  const data = {
    tool: approval.tool,
    category: approval.display.category,
    fields: approval.display.fields,
    accounts: approval.display.accounts,
    amounts: approval.display.amounts,
    cardNumbers: approval.display.cardNumbers,
    externalRecipients: approval.display.externalRecipients,
    payeeFlags: approval.display.payeeFlags,
    reasons: approval.display.reasons,
    rawArguments: approval.display.rawArguments,
    expiresAt: approval.expiresAt,
    csrf: approval.csrf,
  };
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>inboxguard approval</title><style nonce="${nonce}">${PAGE_STYLE}</style></head>
<body><main>
<h1>Approve this action?</h1>
<p class="muted">An AI assistant asked to run <strong id="tool"></strong>. These details come from the actual request, not from the assistant. The request expires at <span id="expires"></span>.</p>
<section aria-labelledby="warn-h"><h2 id="warn-h">Warnings</h2><div id="warnings"></div></section>
<section aria-labelledby="facts-h"><h2 id="facts-h">Request details</h2><dl id="facts"></dl></section>
<section aria-labelledby="reasons-h"><h2 id="reasons-h">Why approval is needed</h2><ul id="reasons"></ul></section>
<section aria-labelledby="raw-h"><h2 id="raw-h">Raw arguments</h2><pre id="raw"></pre></section>
<div class="actions"><button id="approve" class="approve" type="button">Approve once</button><button id="reject" type="button">Reject</button></div>
<p id="status" role="status" aria-live="polite"></p>
</main>
<script id="approval-data" type="application/json">${jsonForScript(data)}</script>
<script nonce="${nonce}">${PAGE_SCRIPT}</script>
</body></html>`;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...securityHeaders('none'),
    ...headers,
  });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function openInBrowser(url) {
  const platformCommands = {
    darwin: ['open', [url]],
    win32: ['cmd', ['/c', 'start', '', url]],
  };
  const [command, args] = platformCommands[process.platform] ?? ['xdg-open', [url]];
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    return;
  }
}

export function createApprovalPage({ store, onDecision = () => {} }) {
  let server = null;
  let port = null;

  const allowedHosts = () => new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const allowedOrigins = () => new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);

  async function handle(req, res) {
    if (!allowedHosts().has(req.headers.host ?? '')) return send(res, 403, { error: 'bad host' });
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    const match = /^\/approval\/([A-Za-z0-9_-]{1,40})(\/decision)?$/.exec(url.pathname);
    if (!match) return send(res, 404, { error: 'not found' });
    const approval = store.get(match[1]);
    if (!approval) return send(res, 404, { error: 'unknown or finished request' });
    if (req.method === 'GET' && !match[2]) return handlePage(req, res, url, approval);
    if (req.method === 'POST' && match[2]) return handleDecision(req, res, approval);
    return send(res, 405, { error: 'method not allowed' });
  }

  function handlePage(req, res, url, approval) {
    if (!safeEqual(url.searchParams.get('token'), approval.token))
      return send(res, 403, { error: 'bad token' });
    const nonce = randomBytes(16).toString('base64');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...securityHeaders(nonce) });
    res.end(renderPage(approval, nonce));
  }

  async function handleDecision(req, res, approval) {
    if (!allowedOrigins().has(req.headers.origin ?? ''))
      return send(res, 403, { error: 'bad origin' });
    if (!(req.headers['content-type'] ?? '').startsWith('application/json'))
      return send(res, 415, { error: 'json required' });
    if (!safeEqual(req.headers['x-inboxguard-csrf'], approval.csrf))
      return send(res, 403, { error: 'bad csrf token' });
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return send(res, 400, { error: 'bad body' });
    }
    if (!safeEqual(body?.csrf, approval.csrf)) return send(res, 403, { error: 'bad csrf token' });
    if (body.decision !== 'approve' && body.decision !== 'reject')
      return send(res, 400, { error: 'bad decision' });
    const decided = store.decide(approval.id, body.decision);
    if (!decided) return send(res, 409, { error: 'request already decided or expired' });
    onDecision(decided);
    return send(res, 200, { ok: true, status: decided.status });
  }

  return {
    async ensureStarted() {
      if (server) return port;
      server = createServer((req, res) => {
        handle(req, res).catch(() => send(res, 500, { error: 'internal error' }));
      });
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      server.unref();
      port = server.address().port;
      return port;
    },

    urlFor(approval) {
      return `http://127.0.0.1:${port}/approval/${approval.id}?token=${approval.token}`;
    },

    async close() {
      if (!server) return;
      await new Promise((resolve) => server.close(resolve));
      server = null;
    },
  };
}
