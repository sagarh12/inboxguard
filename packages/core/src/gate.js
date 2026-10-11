import defaultPolicy from '../policy/default-policy.json' with { type: 'json' };
import {
  scanPaymentText,
  mergeScans,
  hasPaymentSignal,
  comparePayees,
  removeCardNumbers,
} from './payments.js';

export const DEFAULT_POLICY = defaultPolicy;

const DECISION_RANK = { allow: 0, approve: 1, deny: 2 };
const EMAIL = /[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,253}\.[a-z]{2,24}/gi;
const RECIPIENT_KEY =
  /(?:^|\.)(?:to|cc|bcc|recipients?|recipient_?emails?|emails?|address(?:es)?|send_?to|forward_?to|reply_?to)(?:\[\d+\])*$/i;
const ATTACHMENT_KEY = /attach/i;
const DISPLAY_KEY =
  /(?:^|\.)(?:to|cc|bcc|subject|amount|currency|recipient|recipients|payee|beneficiary|account|account_?number|iban|routing|swift|bic|memo|reference|description|note|file|file_?id|role|permission)(?:\[\d+\])*$/i;
const MAX_STRINGS = 5000;
const MAX_DEPTH = 20;

export function tokenizeToolName(name) {
  return String(name ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function wordMatches(token, word) {
  return (
    token === word ||
    token === `${word}s` ||
    token === `${word}es` ||
    token === `${word}d` ||
    token === `${word}ed`
  );
}

function matchesPattern(tokens, pattern) {
  const words = tokenizeToolName(pattern);
  if (words.length === 0) return false;
  for (let i = 0; i + words.length <= tokens.length; i += 1) {
    if (words.every((word, j) => wordMatches(tokens[i + j], word))) return true;
  }
  return false;
}

function matchesAny(tokens, patterns = []) {
  return patterns.some((pattern) => matchesPattern(tokens, pattern));
}

export function collectStrings(value, out = [], depth = 0, path = '') {
  if (depth > MAX_DEPTH || out.length >= MAX_STRINGS) return out;
  if (typeof value === 'string') out.push({ path, value });
  else if (typeof value === 'number' || typeof value === 'bigint')
    out.push({ path, value: String(value) });
  else if (Array.isArray(value))
    value.forEach((item, i) => collectStrings(item, out, depth + 1, `${path}[${i}]`));
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value))
      collectStrings(item, out, depth + 1, path ? `${path}.${key}` : key);
  }
  return out;
}

function hasAttachments(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > MAX_DEPTH) return false;
  for (const [key, item] of Object.entries(value)) {
    if (ATTACHMENT_KEY.test(key) && item && (!Array.isArray(item) || item.length > 0)) return true;
    if (hasAttachments(item, depth + 1)) return true;
  }
  return false;
}

function emailsIn(text) {
  return (String(text).match(EMAIL) ?? []).map((email) => email.toLowerCase());
}

function findRecipients(strings) {
  const fromRecipientKeys = strings
    .filter((s) => RECIPIENT_KEY.test(s.path))
    .flatMap((s) => emailsIn(s.value));
  const recipients =
    fromRecipientKeys.length > 0 ? fromRecipientKeys : strings.flatMap((s) => emailsIn(s.value));
  return [...new Set(recipients)];
}

function isTrusted(email, trustedDomains) {
  const domain = email.split('@')[1] ?? '';
  return trustedDomains.some((trusted) => {
    const value = String(trusted).toLowerCase();
    return domain === value || domain.endsWith(`.${value}`);
  });
}

export function classifyTool(tool, policy = DEFAULT_POLICY) {
  const tokens = tokenizeToolName(tool);
  const readOnly =
    matchesAny(tokens, policy.readOnlyPatterns) && !matchesAny(tokens, policy.writePatterns);
  const categories = Object.entries(policy.categories ?? {}).sort(
    ([, a], [, b]) => DECISION_RANK[b.decision] - DECISION_RANK[a.decision],
  );
  for (const [name, category] of categories) {
    if (readOnly && !category.appliesToReadOnly) continue;
    if (matchesAny(tokens, category.toolPatterns))
      return { category: name, decision: category.decision, readOnly };
  }
  if (readOnly) return { category: 'read-only', decision: 'allow', readOnly };
  return {
    category: 'unrecognized-write',
    decision: policy.unknownToolDecision ?? 'approve',
    readOnly,
  };
}

function strongest(a, b) {
  return DECISION_RANK[b] > DECISION_RANK[a] ? b : a;
}

function displayFields(strings) {
  return strings
    .filter((s) => DISPLAY_KEY.test(s.path))
    .slice(0, 50)
    .map((s) => ({ field: s.path, value: removeCardNumbers(s.value).slice(0, 500) }));
}

function describeScan(scan) {
  const reasons = [];
  const types = [...new Set(scan.accounts.map((a) => a.type))];
  if (types.length > 0) reasons.push(`payment account details in arguments: ${types.join(', ')}`);
  if (scan.amounts.length > 0) reasons.push('money amount in arguments');
  if (scan.paymentWords.length > 0)
    reasons.push(`payment language in arguments: ${scan.paymentWords.slice(0, 5).join(', ')}`);
  if (scan.interac) reasons.push('Interac e-Transfer language in arguments');
  if (scan.cardCount > 0) reasons.push('card number in arguments (not shown)');
  return reasons;
}

function describePayeeFlag(flag) {
  if (flag.flag === 'payee-account-mismatch')
    return `WARNING: ${flag.type} ${flag.account} is not a known account for payee ${flag.payee}`;
  if (flag.flag === 'payee-email-mismatch')
    return `WARNING: ${flag.email} is not a known address for payee ${flag.payee}`;
  return `WARNING: ${flag.type} ${flag.account} is not in payees.json`;
}

function outboundDecision(classification, recipients, attachments, policy) {
  const settings = policy.categories?.['outbound-mail'] ?? {};
  const trusted = settings.trustedDomains ?? [];
  const external = recipients.filter((email) => !isTrusted(email, trusted));
  const allTrusted = recipients.length > 0 && external.length === 0 && trusted.length > 0;
  if (allTrusted && !attachments && settings.allowTrustedWithoutAttachments !== false) {
    return {
      decision: 'allow',
      external,
      reason: 'all recipients are in trusted domains and there are no attachments',
    };
  }
  const reason =
    external.length > 0
      ? `outbound message to external recipients: ${external.join(', ')}`
      : 'outbound message';
  return {
    decision: classification.decision,
    external,
    reason: attachments ? `${reason}, with attachments` : reason,
  };
}

export function evaluateAction({ tool, args, session } = {}, policy = DEFAULT_POLICY) {
  const classification = classifyTool(tool, policy);
  const strings = collectStrings(args ?? {});
  const recipients = findRecipients(strings);
  const attachments = hasAttachments(args);
  const reasons = [];
  let decision = classification.decision;
  let external = [];

  if (classification.category === 'outbound-mail') {
    const outbound = outboundDecision(classification, recipients, attachments, policy);
    decision = outbound.decision;
    external = outbound.external;
    reasons.push(outbound.reason);
  } else if (classification.category === 'read-only') {
    reasons.push('read-only tool');
  } else if (classification.category === 'unrecognized-write') {
    reasons.push('tool is not recognized as read-only, so it is treated as a write');
  } else {
    reasons.push(`tool matches the ${classification.category} category`);
  }

  const scan =
    policy.contentChecks === false
      ? mergeScans([])
      : mergeScans(strings.map((s) => scanPaymentText(s.value)));
  if (classification.readOnly) {
    scan.paymentWords = [];
    scan.interac = false;
  }
  const allText = strings.map((s) => s.value).join('\n');
  const payeeFlags = hasPaymentSignal(scan)
    ? comparePayees(scan, allText, recipients, policy.payees)
    : [];
  if (hasPaymentSignal(scan)) {
    decision = strongest(decision, 'approve');
    reasons.push(...describeScan(scan));
    reasons.push(...payeeFlags.map(describePayeeFlag));
  }

  const tainted =
    policy.sessionTaint !== false && Boolean(session?.tainted) && !classification.readOnly;
  if (tainted) {
    decision = strongest(decision, 'approve');
    const why = session.reasons?.length ? `: ${session.reasons.slice(-3).join('; ')}` : '';
    reasons.push(`this session already read content judged suspicious or malicious${why}`);
  }

  return {
    decision,
    category: classification.category,
    reasons,
    details: {
      tool: String(tool ?? ''),
      readOnly: classification.readOnly,
      recipients,
      externalRecipients: external,
      attachments,
      accounts: scan.accounts,
      amounts: scan.amounts,
      paymentWords: scan.paymentWords,
      interac: scan.interac,
      cardNumbers: scan.cardCount,
      payeeFlags,
      tainted,
      fields: displayFields(strings),
    },
  };
}

export function redactArguments(value, depth = 0) {
  if (depth > MAX_DEPTH) return '[too deep]';
  if (typeof value === 'string') return removeCardNumbers(value);
  if (typeof value === 'number') {
    const text = String(value);
    return removeCardNumbers(text) === text ? value : '[card number removed]';
  }
  if (Array.isArray(value)) return value.map((item) => redactArguments(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, redactArguments(v, depth + 1)]),
    );
  }
  return value;
}
