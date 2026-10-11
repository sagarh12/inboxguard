import { analyzeHtml } from './hidden.js';
import { analyzeInvisible } from './unicode.js';
import { decodeLayers } from './decode.js';
import { buildCleanedText } from './clean.js';
import { resolveLimits, createBudget, capText } from './limits.js';
import {
  createCollector,
  judgeText,
  judgeDecoded,
  judgeInvisible,
  recordLimits,
  failureFinding,
  finalize,
} from './verdict.js';

export { detectInstructions, isAddressedToAi, RULE_SETS } from './detect.js';
export { analyzeInvisible, escapeForSnippet } from './unicode.js';
export { DEFAULT_LIMITS } from './limits.js';
export {
  evaluateAction,
  classifyTool,
  redactArguments,
  collectStrings,
  DEFAULT_POLICY,
} from './gate.js';
export { scanPaymentText, removeCardNumbers } from './payments.js';

const SKIPPED_HEADERS = new Set([
  'dkim-signature',
  'arc-seal',
  'arc-message-signature',
  'arc-authentication-results',
  'authentication-results',
  'received',
  'received-spf',
  'x-google-dkim-signature',
  'x-gm-message-state',
  'x-google-smtp-source',
  'x-received',
  'message-id',
  'references',
  'in-reply-to',
]);

const TEXT_ATTACHMENT =
  /^(?:text\/|application\/(?:json|xml|x-yaml|javascript|ecmascript|ld\+json|csv))/i;
const TEXT_EXTENSION = /\.(?:txt|csv|md|markdown|html?|json|xml|ya?ml|ics|eml|log|js|py|sh)$/i;

function asText(value) {
  if (value === undefined || value === null) return '';
  if (value instanceof Uint8Array) return new TextDecoder('utf-8').decode(value);
  if (value instanceof ArrayBuffer) return new TextDecoder('utf-8').decode(new Uint8Array(value));
  return typeof value === 'string' ? value : String(value);
}

function createInputCapper(budget) {
  let remaining = budget.limits.maxInputBytes;
  return (value) => {
    const capped = capText(asText(value), Math.max(0, remaining));
    remaining -= capped.text.length;
    if (capped.truncated) budget.hit('input-size');
    return capped.text;
  };
}

function inspectPlainText(collector, budget, context, options = {}) {
  if (!context.text) return null;
  const invisible = analyzeInvisible(context.text);
  if (budget.expired()) return invisible;
  judgeText(collector, context);
  if (budget.expired()) return invisible;
  judgeInvisible(collector, context, invisible.issues, options);
  if (budget.expired()) return invisible;
  for (const layer of decodeLayers(context.text, budget)) judgeDecoded(collector, context, layer);
  return invisible;
}

function inspectHtml(collector, budget, html, prefix, visibleExposure) {
  const analysis = analyzeHtml(html, budget);
  const visibleContext = {
    where: `${prefix} visible text`,
    text: analysis.visibleText,
    exposure: visibleExposure,
  };
  analysis.visibleInvisible = inspectPlainText(collector, budget, visibleContext);
  for (const segment of analysis.hiddenSegments) {
    if (budget.expired()) break;
    const context = {
      where: `${prefix} hidden text (${segment.reason}) <${segment.tag}>`,
      text: segment.text,
      exposure: 'hidden',
      carrier: 'hidden-text',
      early: segment.early,
    };
    inspectPlainText(collector, budget, context, { skipPlainInvisible: true });
  }
  inspectCombinedHidden(collector, analysis.hiddenSegments, prefix);
  for (const carrier of analysis.carriers) {
    if (budget.expired()) break;
    const context = {
      where: `${prefix} ${carrier.where}`,
      text: carrier.text,
      exposure: carrier.context,
      carrier: carrier.kind,
      conditional: carrier.conditional,
      encodedBenignSeverity: 'info',
    };
    inspectPlainText(collector, budget, context, { skipPlainInvisible: true });
  }
  for (const url of analysis.urls) {
    if (budget.expired()) break;
    const context = {
      where: `${prefix} <${url.tag} ${url.attribute}>`,
      text: url.value,
      encodedBenignSeverity: 'info',
    };
    for (const layer of decodeLayers(url.value, budget)) judgeDecoded(collector, context, layer);
  }
  return analysis;
}

function inspectCombinedHidden(collector, segments, prefix) {
  if (segments.length < 2) return;
  if (collector.findings.some((f) => f.kind === 'hidden-instruction')) return;
  const probe = createCollector(collector.budget);
  const context = {
    where: `${prefix} hidden text (combined)`,
    text: segments.map((s) => s.text).join(' '),
    exposure: 'hidden',
  };
  if (judgeText(probe, context).matches.length > 0) collector.add(probe.findings[0]);
}

function headerEntries(headers) {
  if (!headers) return [];
  if (Array.isArray(headers)) return headers.map((h) => [h.name ?? h.key ?? h[0], h.value ?? h[1]]);
  if (headers instanceof Map) return [...headers.entries()];
  return Object.entries(headers);
}

function inspectHeaders(collector, budget, headers, cap) {
  for (const [rawName, rawValue] of headerEntries(headers)) {
    const name = String(rawName ?? '').toLowerCase();
    if (!name || SKIPPED_HEADERS.has(name) || name === 'subject' || name === 'from') continue;
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      const text = cap(typeof value === 'object' && value !== null ? JSON.stringify(value) : value);
      if (text) judgeText(collector, { where: `header ${name}`, text, exposure: 'hidden' });
    }
  }
}

function isTextAttachment(attachment) {
  return (
    TEXT_ATTACHMENT.test(attachment.contentType ?? '') ||
    TEXT_EXTENSION.test(attachment.filename ?? '')
  );
}

function inspectAttachments(collector, budget, attachments, cap) {
  for (const attachment of Array.isArray(attachments) ? attachments : []) {
    if (budget.expired()) break;
    const name = asText(attachment?.filename ?? attachment?.name ?? 'attachment');
    inspectPlainText(collector, budget, {
      where: 'attachment filename',
      text: name,
      exposure: 'visible',
    });
    if (!isTextAttachment(attachment ?? {})) continue;
    const content = cap(attachment.content ?? attachment.text ?? attachment.data);
    if (/html/i.test(attachment.contentType ?? '') || /\.html?$/i.test(name)) {
      inspectHtml(collector, budget, content, `attachment ${name}`, 'semi');
    } else {
      inspectPlainText(collector, budget, {
        where: `attachment ${name}`,
        text: content,
        exposure: 'semi',
      });
    }
  }
}

function runInspection(input, budget) {
  const collector = createCollector(budget);
  const cap = createInputCapper(budget);
  const html = cap(input.html);
  const text = cap(input.text);
  inspectPlainText(collector, budget, {
    where: 'subject',
    text: cap(input.subject),
    exposure: 'visible',
  });
  inspectPlainText(collector, budget, {
    where: 'from',
    text: cap(input.from),
    exposure: 'visible',
  });
  const analysis = html ? inspectHtml(collector, budget, html, 'html', 'visible') : null;
  const textInvisible = inspectPlainText(collector, budget, {
    where: 'text body',
    text,
    exposure: 'visible',
  });
  inspectHeaders(collector, budget, input.headers, cap);
  inspectAttachments(collector, budget, input.attachments, cap);
  if (analysis && !analysis.completed) budget.hit('time');
  budget.expired();
  recordLimits(collector, budget.hits());
  const cleanedText = buildCleanedText(analysis ? analysis.visibleInvisible : textInvisible);
  const { verdict, score } = finalize(collector.findings);
  return {
    verdict,
    score,
    cleanedText,
    findings: collector.findings,
    truncated: budget.hits().length > 0,
  };
}

export function inspectEmail(input = {}, options = {}) {
  const budget = createBudget(resolveLimits(options.limits), options.now);
  try {
    return runInspection(input && typeof input === 'object' ? input : { text: input }, budget);
  } catch (error) {
    const findings = [failureFinding(error)];
    return { verdict: 'suspicious', score: 40, cleanedText: '', findings, truncated: true };
  }
}
