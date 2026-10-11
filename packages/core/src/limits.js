export const DEFAULT_LIMITS = Object.freeze({
  maxInputBytes: 5 * 1024 * 1024,
  maxDomDepth: 256,
  timeBudgetMs: 2000,
  maxDecodeDepth: 3,
  maxDecodedBytes: 1024 * 1024,
  maxStyleRules: 2000,
  maxFindings: 200,
});

export function resolveLimits(overrides = {}) {
  return { ...DEFAULT_LIMITS, ...overrides };
}

export function createBudget(limits, now = () => Date.now()) {
  const deadline = now() + limits.timeBudgetMs;
  const hits = new Set();
  return {
    limits,
    expired() {
      if (now() <= deadline) return false;
      hits.add('time');
      return true;
    },
    hit(name) {
      hits.add(name);
    },
    hits() {
      return [...hits];
    },
  };
}

export function byteLength(text) {
  return new TextEncoder().encode(text).length;
}

export function capText(text, maxBytes) {
  const value = String(text ?? '');
  if (value.length * 3 <= maxBytes) return { text: value, truncated: false };
  const bytes = byteLength(value);
  if (bytes <= maxBytes) return { text: value, truncated: false };
  const keepChars = Math.floor(value.length * (maxBytes / bytes));
  return { text: value.slice(0, keepChars), truncated: true };
}
