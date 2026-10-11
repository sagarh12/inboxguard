const ZERO_WIDTH = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff]);

const OTHER_INVISIBLE = new Set([
  0x180e, 0x00ad, 0x2061, 0x2062, 0x2063, 0x2064, 0x3164, 0x115f, 0x1160, 0x2800, 0x202a, 0x202b,
  0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
]);

const SOFT_HYPHEN = 0x00ad;
const BOM = 0xfeff;
const ZWJ = 0x200d;
const ZWNJ = 0x200c;
const BLACK_FLAG = 0x1f3f4;
const CANCEL_TAG = 0xe007f;

const JOINING_SCRIPT =
  /[\p{Script=Arabic}\p{Script=Syriac}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}\p{Script=Khmer}\p{Script=Myanmar}\p{Script=Mongolian}\p{Script=Nko}]/u;
const PICTOGRAPHIC = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}]/u;
const LATIN_LETTER = /\p{Script=Latin}/u;
const HAN = /\p{Script=Han}/u;
const WHITESPACE = /\s/u;
const LETTER_OR_NUMBER = /[\p{L}\p{N}]/u;
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u;

export function isTagChar(cp) {
  return cp >= 0xe0000 && cp <= 0xe007f;
}

export function isVariationSelector(cp) {
  return (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef);
}

export function isInvisible(cp) {
  return ZERO_WIDTH.has(cp) || OTHER_INVISIBLE.has(cp) || isTagChar(cp) || isVariationSelector(cp);
}

const ALL_INVISIBLE =
  /[\u00ad\u034fᅟᅠ\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069⠀ㅤ\ufe00-\ufe0f\ufeff\u{e0000}-\u{e007f}\u{e0100}-\u{e01ef}]/gu;

export function removeAllInvisible(text) {
  return text.replace(ALL_INVISIBLE, '');
}

export function escapeForSnippet(text, max = 160) {
  const flat = String(text ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
  let out = '';
  for (const ch of flat) {
    const cp = ch.codePointAt(0);
    const piece = isInvisible(cp) || CONTROL_OR_FORMAT.test(ch) ? formatCodePoint(cp) : ch;
    if (out.length + piece.length > max) return out.slice(0, max - 1) + '…';
    out += piece;
  }
  return out;
}

function formatCodePoint(cp) {
  return `<U+${cp.toString(16).toUpperCase().padStart(4, '0')}>`;
}

export function printableRatio(text) {
  if (!text) return 0;
  let printable = 0;
  let total = 0;
  for (const ch of text) {
    total += 1;
    if (ch === '\n' || ch === '\t' || ch === '\r' || !CONTROL_OR_FORMAT.test(ch)) printable += 1;
  }
  return printable / total;
}

export function hasRealWords(text, minWords = 3) {
  const latinWords = text.match(/\p{L}{3,}/gu) ?? [];
  const cjk = text.match(
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu,
  );
  return latinWords.length >= minWords || (cjk?.length ?? 0) >= 4;
}

export function looksLikeText(text) {
  return printableRatio(text) >= 0.9 && hasRealWords(text) && /[\s\p{Script=Han}]/u.test(text);
}

function toCodePoints(text) {
  return Array.from(text, (ch) => ch.codePointAt(0));
}

function charOf(cp) {
  return cp === undefined ? '' : String.fromCodePoint(cp);
}

function findRuns(cps) {
  const runs = [];
  let start = -1;
  for (let i = 0; i <= cps.length; i += 1) {
    const invisible = i < cps.length && isInvisible(cps[i]);
    if (invisible && start === -1) start = i;
    if (!invisible && start !== -1) {
      runs.push({ start, end: i });
      start = -1;
    }
  }
  return runs;
}

function isLegitFlagTagRun(run, prev) {
  if (prev !== BLACK_FLAG) return false;
  if (run.length > 8 || run[run.length - 1] !== CANCEL_TAG) return false;
  return run.every(isTagChar);
}

function isLegitEmojiJoin(run, prev, next) {
  if (run.length > 3) return false;
  if (!run.every((cp) => cp === ZWJ || cp === 0xfe0f || cp === 0xfe0e)) return false;
  const prevOk = PICTOGRAPHIC.test(charOf(prev));
  const nextOk = next === undefined || PICTOGRAPHIC.test(charOf(next)) || !run.includes(ZWJ);
  return prevOk && nextOk;
}

function isLegitScriptJoin(run, prev, next) {
  if (run.length > 2) return false;
  if (!run.every((cp) => cp === ZWJ || cp === ZWNJ)) return false;
  return JOINING_SCRIPT.test(charOf(prev)) || JOINING_SCRIPT.test(charOf(next));
}

function isLegitSingleVariationSelector(run, prev) {
  if (run.length !== 1 || !isVariationSelector(run[0])) return false;
  const prevChar = charOf(prev);
  if (!prevChar || WHITESPACE.test(prevChar)) return false;
  if (run[0] >= 0xe0100) return HAN.test(prevChar);
  return !LATIN_LETTER.test(prevChar);
}

export function decodeTagRun(run) {
  return run
    .filter((cp) => cp >= 0xe0020 && cp <= 0xe007e)
    .map((cp) => String.fromCharCode(cp - 0xe0000))
    .join('');
}

export function decodeVariationSelectorRun(run) {
  const bytes = run
    .filter(isVariationSelector)
    .map((cp) => (cp <= 0xfe0f ? cp - 0xfe00 : cp - 0xe0100 + 16));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return '';
  }
}

function bitsToText(groups) {
  let out = '';
  for (const bits of groups) {
    if (bits.length === 0 || bits.length > 21) return '';
    const value = parseInt(bits, 2);
    if (value > 0x10ffff) return '';
    out += String.fromCodePoint(value);
  }
  return out;
}

function acceptDecodedBinary(text) {
  return text.length >= 3 && printableRatio(text) >= 0.9 && /[\p{L}]{2,}/u.test(text);
}

function decodeTwoSymbol(run, zero) {
  const bits = run.map((cp) => (cp === zero ? '0' : '1')).join('');
  if (bits.length % 8 !== 0) return '';
  const bytes = [];
  for (let i = 0; i < bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return '';
  }
}

function decodeWithSeparator(run, separator, zero) {
  const groups = [];
  let current = '';
  for (const cp of run) {
    if (cp === separator) {
      if (current) groups.push(current);
      current = '';
    } else {
      current += cp === zero ? '0' : '1';
    }
  }
  if (current) groups.push(current);
  return bitsToText(groups);
}

function dropRareMarkers(run) {
  const counts = new Map();
  for (const cp of run) counts.set(cp, (counts.get(cp) ?? 0) + 1);
  if (counts.size <= 3) return run;
  const rare = new Set([...counts].filter(([, n]) => n <= 2).map(([cp]) => cp));
  return run.filter((cp) => !rare.has(cp));
}

export function decodeZeroWidthBinary(rawRun) {
  if (rawRun.length < 8 || !rawRun.every((cp) => ZERO_WIDTH.has(cp))) return '';
  const run = dropRareMarkers(rawRun);
  const symbols = [...new Set(run)];
  const candidates = [];
  if (symbols.length === 2) {
    candidates.push(decodeTwoSymbol(run, symbols[0]), decodeTwoSymbol(run, symbols[1]));
  }
  if (symbols.length === 3) {
    for (const separator of symbols) {
      const others = symbols.filter((cp) => cp !== separator);
      candidates.push(decodeWithSeparator(run, separator, others[0]));
      candidates.push(decodeWithSeparator(run, separator, others[1]));
    }
  }
  return candidates.find(acceptDecodedBinary) ?? '';
}

function classifyRun(run, prev, next, isTextStart) {
  if (run.some(isTagChar)) {
    if (isLegitFlagTagRun(run, prev)) return { action: 'keep' };
    return { action: 'abuse', kind: 'unicode-tags', decoded: decodeTagRun(run) };
  }
  if (isLegitEmojiJoin(run, prev, next)) return { action: 'keep' };
  if (isLegitScriptJoin(run, prev, next)) return { action: 'keep' };
  if (isLegitSingleVariationSelector(run, prev)) return { action: 'keep' };
  if (run.length >= 2 && run.every(isVariationSelector)) {
    return {
      action: 'abuse',
      kind: 'variation-selector-payload',
      decoded: decodeVariationSelectorRun(run),
    };
  }
  if (run.length === 1 && run[0] === BOM && isTextStart) return { action: 'strip' };
  if (run.length === 1 && run[0] === SOFT_HYPHEN) return { action: 'strip' };
  if (run.length >= 8 && run.every((cp) => ZERO_WIDTH.has(cp))) {
    const decoded = decodeZeroWidthBinary(run);
    if (decoded) return { action: 'abuse', kind: 'zero-width-binary', decoded };
  }
  if (run.length >= 2) return { action: 'abuse', kind: 'invisible-characters' };
  const betweenLatin = LATIN_LETTER.test(charOf(prev)) && LATIN_LETTER.test(charOf(next));
  if (betweenLatin) return { action: 'abuse', kind: 'invisible-characters', single: true };
  if (isVariationSelector(run[0])) return { action: 'strip' };
  return { action: 'keep' };
}

export function analyzeInvisible(text) {
  const source = String(text ?? '');
  const cps = toCodePoints(source);
  const runs = findRuns(cps);
  const issues = [];
  const removed = new Set();
  for (const range of runs) {
    const run = cps.slice(range.start, range.end);
    const prev = cps[range.start - 1];
    const next = cps[range.end];
    const verdict = classifyRun(run, prev, next, range.start === 0);
    if (verdict.action === 'keep') continue;
    for (let i = range.start; i < range.end; i += 1) removed.add(i);
    if (verdict.action === 'strip') continue;
    issues.push({
      kind: verdict.kind,
      decoded: verdict.decoded || '',
      length: run.length,
      single: Boolean(verdict.single),
      context: contextAround(cps, range.start, range.end),
    });
  }
  const cleaned = removed.size === 0 ? source : rebuildWithout(cps, removed);
  return { cleaned, issues };
}

function contextAround(cps, start, end) {
  const from = Math.max(0, start - 20);
  const to = Math.min(cps.length, end + 20);
  return String.fromCodePoint(...cps.slice(from, Math.min(to, from + 400)));
}

function rebuildWithout(cps, removed) {
  let out = '';
  for (let i = 0; i < cps.length; i += 1) if (!removed.has(i)) out += String.fromCodePoint(cps[i]);
  return out;
}

export function stripAbusiveInvisible(text) {
  return analyzeInvisible(text).cleaned;
}

export function isWordChar(ch) {
  return LETTER_OR_NUMBER.test(ch);
}
