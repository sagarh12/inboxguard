const roots = new WeakMap();

const STATES = {
  green: { label: 'inboxguard: no hidden content found', tone: 'green' },
  amber: {
    label: 'inboxguard: hidden or encoded content found, no instructions to an AI',
    tone: 'amber',
  },
  red: { label: 'inboxguard: hidden instructions aimed at AI assistants found', tone: 'red' },
  unknown: { label: 'inboxguard: unable to check this message', tone: 'grey' },
  'too-large': { label: 'inboxguard: message too large to check', tone: 'grey' },
};

const STYLE = `
:host { all: initial; display: block; margin: 6px 0; font: 13px/1.4 system-ui, -apple-system, Segoe UI, sans-serif; }
.bar { border-radius: 6px; padding: 6px 10px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; border: 1px solid; }
.green { background: #ecfdf3; color: #05603a; border-color: #a6f4c5; }
.amber { background: #fffaeb; color: #93370d; border-color: #fedf89; }
.red { background: #fef3f2; color: #912018; border-color: #fda29b; }
.grey { background: #f2f4f7; color: #344054; border-color: #d0d5dd; }
@media (prefers-color-scheme: dark) {
  .green { background: #053321; color: #a6f4c5; border-color: #067647; }
  .amber { background: #4e1d09; color: #fedf89; border-color: #b54708; }
  .red { background: #55160c; color: #fecdca; border-color: #b42318; }
  .grey { background: #1d2939; color: #d0d5dd; border-color: #475467; }
}
.label { font-weight: 600; flex: 1 1 auto; }
button { font: inherit; background: transparent; color: inherit; border: 1px solid currentColor; border-radius: 4px; padding: 2px 8px; cursor: pointer; }
button:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
.details { flex-basis: 100%; margin: 6px 0 0; padding: 0; list-style: none; }
.details li { margin: 4px 0; }
.kind { font-weight: 600; }
pre { white-space: pre-wrap; word-break: break-word; margin: 2px 0 0; font: 12px/1.4 ui-monospace, Menlo, monospace; }
`;

function element(doc, tag, text, className) {
  const node = doc.createElement(tag);
  if (text !== undefined) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}

function findingItem(doc, finding) {
  const item = element(doc, 'li');
  item.append(
    element(doc, 'span', `${finding.severity} ${finding.kind}`, 'kind'),
    element(doc, 'span', ` in ${finding.where}`),
  );
  if (finding.snippet) item.append(element(doc, 'pre', finding.snippet));
  if (finding.decoded) item.append(element(doc, 'pre', `decoded: ${finding.decoded}`));
  return item;
}

export function buildReport({ state, findings = [], elapsedMs, neutralized = 0 }) {
  const lines = [
    `inboxguard report`,
    `state: ${state}`,
    `findings: ${findings.length}`,
    `hidden nodes neutralized: ${neutralized}`,
  ];
  if (elapsedMs !== undefined) lines.push(`check time: ${Math.round(elapsedMs)} ms`);
  for (const finding of findings) {
    lines.push(`- ${finding.severity} ${finding.kind} in ${finding.where}: ${finding.snippet}`);
    if (finding.decoded) lines.push(`  decoded: ${finding.decoded}`);
  }
  return lines.join('\n');
}

async function copyText(doc, text) {
  try {
    await doc.defaultView.navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function createBanner(doc, report) {
  const config = STATES[report.state] ?? STATES.unknown;
  const host = element(doc, 'div');
  host.setAttribute('data-inboxguard-banner', report.state);
  const root = host.attachShadow({ mode: 'closed' });
  roots.set(host, root);
  const style = element(doc, 'style', STYLE);
  const bar = element(doc, 'div', undefined, `bar ${config.tone}`);
  bar.setAttribute('role', 'status');
  bar.setAttribute('aria-live', 'polite');
  bar.append(element(doc, 'span', config.label, 'label'));
  const findings = (report.findings ?? []).filter(
    (f) => f.severity !== 'info' || report.state !== 'green',
  );
  if (findings.length > 0) {
    const list = element(doc, 'ul', undefined, 'details');
    list.hidden = true;
    list.id = 'inboxguard-details';
    for (const finding of findings.slice(0, 50)) list.append(findingItem(doc, finding));
    const toggle = element(doc, 'button', 'Details');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'inboxguard-details');
    toggle.addEventListener('click', () => {
      list.hidden = !list.hidden;
      toggle.setAttribute('aria-expanded', String(!list.hidden));
    });
    bar.append(toggle);
    bar.append(copyButton(doc, report));
    bar.append(list);
  }
  root.append(style, bar);
  return host;
}

function copyButton(doc, report) {
  const button = element(doc, 'button', 'Copy report');
  button.type = 'button';
  button.addEventListener('click', async () => {
    const copied = await copyText(doc, buildReport(report));
    button.textContent = copied ? 'Copied' : 'Copy failed';
  });
  return button;
}

export function bannerRootForTests(host) {
  return roots.get(host) ?? null;
}
