import { detectInstructions, isAddressedToAi } from './detect.js';
import { escapeForSnippet } from './unicode.js';

const SEVERITY_RANK = { info: 0, low: 1, medium: 2, high: 3 };
const SEVERITY_BASE = { info: 0, low: 10, medium: 40, high: 80 };
const SEVERITY_CEILING = { info: 9, low: 29, medium: 69, high: 100 };
const PREHEADER_MAX_LENGTH = 300;

export function createCollector(budget) {
  const limits = budget.limits;
  const findings = [];
  const seen = new Set();
  return {
    budget,
    add(finding) {
      const key = `${finding.kind}|${finding.where}|${finding.snippet}|${finding.decoded ?? ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (findings.length >= limits.maxFindings) return;
      findings.push(finding);
    },
    findings,
  };
}

function makeFinding({ kind, severity, hidden, where, text, decoded, rule }) {
  return {
    kind,
    severity,
    hidden: Boolean(hidden),
    where,
    snippet: escapeForSnippet(text),
    decoded: decoded ? escapeForSnippet(decoded, 1000) : null,
    rule: rule ?? null,
  };
}

function ruleList(detection) {
  return [...new Set(detection.matches.map((m) => m.rule))].join(',');
}

function wordCount(text) {
  return (text.match(/[\p{L}\p{N}]{2,}/gu) ?? []).length;
}

export function judgeText(collector, context) {
  const detection = detectInstructions(context.text, { budget: collector.budget });
  const base = { where: context.where, text: context.text, hidden: context.exposure === 'hidden' };
  if (detection.matches.length > 0) {
    collector.add(
      makeFinding({
        ...base,
        ...instructionVerdict(context, detection),
        rule: ruleList(detection),
      }),
    );
    return detection;
  }
  const benign = benignHiddenVerdict(context);
  if (benign) collector.add(makeFinding({ ...base, ...benign }));
  return detection;
}

function instructionVerdict(context, detection) {
  if (context.exposure === 'hidden') return { kind: 'hidden-instruction', severity: 'high' };
  if (context.exposure === 'semi') {
    return {
      kind: 'carrier-instruction',
      severity: isAddressedToAi(detection) ? 'high' : 'medium',
    };
  }
  if (isAddressedToAi(detection) || detection.categories.has('exfiltration')) {
    return { kind: 'visible-instruction', severity: 'medium' };
  }
  return { kind: 'quoted-instruction', severity: 'info' };
}

function benignHiddenVerdict(context) {
  if (context.exposure !== 'hidden') return null;
  if (context.carrier === 'hidden-text') {
    const length = context.text.replace(/\s+/g, ' ').trim().length;
    if (context.early && length <= PREHEADER_MAX_LENGTH)
      return { kind: 'preheader', severity: 'info' };
    return { kind: 'hidden-text', severity: 'low' };
  }
  if (context.carrier === 'comment' && !context.conditional && wordCount(context.text) >= 8) {
    return { kind: 'hidden-comment', severity: 'info' };
  }
  return null;
}

export function judgeDecoded(collector, context, layer) {
  const detection = detectInstructions(layer.decoded, { budget: collector.budget });
  const where = `${context.where} (${layer.chain.join(' > ')})`;
  const base = { where, text: layer.original, decoded: layer.decoded, hidden: true };
  if (detection.matches.length > 0) {
    collector.add(
      makeFinding({
        ...base,
        kind: 'encoded-instruction',
        severity: 'high',
        rule: ruleList(detection),
      }),
    );
    return;
  }
  const severity = context.encodedBenignSeverity ?? 'low';
  collector.add(makeFinding({ ...base, kind: 'encoded-text', severity }));
}

export function judgeInvisible(collector, context, issues, options = {}) {
  const singles = issues.filter((issue) => issue.kind === 'invisible-characters' && issue.single);
  for (const issue of issues) {
    if (issue.kind === 'invisible-characters' && options.skipPlainInvisible) continue;
    const decodedDetection = issue.decoded
      ? detectInstructions(issue.decoded, { budget: collector.budget })
      : null;
    const severity = invisibleSeverity(issue, decodedDetection, singles.length);
    collector.add(
      makeFinding({
        kind: decodedDetection?.matches.length ? 'smuggled-instruction' : issue.kind,
        severity,
        hidden: true,
        where: context.where,
        text: issue.context,
        decoded: issue.decoded,
        rule: decodedDetection?.matches.length ? ruleList(decodedDetection) : null,
      }),
    );
  }
}

function invisibleSeverity(issue, decodedDetection, singleCount) {
  if (decodedDetection?.matches.length) return 'high';
  if (issue.kind === 'invisible-characters' && issue.single && singleCount < 2) return 'low';
  return 'medium';
}

export function recordLimits(collector, hits) {
  if (hits.length === 0) return;
  collector.add(
    makeFinding({
      kind: 'limit-reached',
      severity: 'medium',
      hidden: false,
      where: 'engine',
      text: `inspection limit reached: ${hits.join(', ')}`,
      rule: 'limits',
    }),
  );
}

export function failureFinding(error) {
  return makeFinding({
    kind: 'inspection-failed',
    severity: 'medium',
    hidden: false,
    where: 'engine',
    text: `inspection failed: ${error?.name ?? 'Error'}`,
    rule: 'engine',
  });
}

export function finalize(findings) {
  let top = null;
  for (const finding of findings) {
    if (top === null || SEVERITY_RANK[finding.severity] > SEVERITY_RANK[top])
      top = finding.severity;
  }
  if (top === null) return { verdict: 'clean', score: 0 };
  const extra = findings.filter((f) => f.severity !== 'info').length - 1;
  const score = Math.min(SEVERITY_CEILING[top], SEVERITY_BASE[top] + Math.max(0, extra) * 3);
  const verdict = top === 'high' ? 'malicious' : top === 'medium' ? 'suspicious' : 'clean';
  return { verdict, score };
}
