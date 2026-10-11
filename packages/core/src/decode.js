import { looksLikeText, printableRatio } from './unicode.js';

const BASE64_TOKEN = /[A-Za-z0-9+/_-]{24,}={0,2}/g;
const HEX_TOKEN = /(?<![0-9A-Za-z])(?:[0-9a-fA-F]{2}){12,}(?![0-9A-Za-z])/g;
const ESCAPED_HEX = /(?:\\x[0-9a-fA-F]{2}){6,}/g;
const NUMERIC_ENTITIES = /(?:&#(?:[xX][0-9a-fA-F]{1,6}|[0-9]{1,7});?){6,}/g;
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g;
const DATA_IMAGE = /data:image\/[a-z0-9.+-]{1,40}(?:;[a-z0-9=.-]{1,40}){0,4},[A-Za-z0-9+/=_%-]*/gi;
const PERCENT_SEQUENCE = /%[0-9a-fA-F]{2}/g;

const BINARY_MAGIC = [
  [0x89, 0x50, 0x4e, 0x47],
  [0xff, 0xd8, 0xff],
  [0x47, 0x49, 0x46, 0x38],
  [0x25, 0x50, 0x44, 0x46],
  [0x50, 0x4b, 0x03, 0x04],
  [0x52, 0x49, 0x46, 0x46],
  [0x1f, 0x8b],
];

const utf8 = new TextDecoder('utf-8', { fatal: true });

function startsWithMagic(bytes) {
  return BINARY_MAGIC.some((magic) => magic.every((byte, i) => bytes[i] === byte));
}

function bytesToText(bytes) {
  if (bytes.length === 0 || startsWithMagic(bytes)) return '';
  try {
    return utf8.decode(bytes);
  } catch {
    return '';
  }
}

export function decodeBase64Token(token) {
  const body = token.replace(/=+$/, '');
  if (body.length % 4 === 1) return '';
  const standard = body.replace(/-/g, '+').replace(/_/g, '/');
  const padded = standard + '='.repeat((4 - (standard.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytesToText(bytes);
  } catch {
    return '';
  }
}

export function decodeHexToken(token) {
  const bytes = new Uint8Array(token.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(token.slice(i * 2, i * 2 + 2), 16);
  return bytesToText(bytes);
}

function decodeEscapedHex(token) {
  return decodeHexToken(token.replace(/\\x/g, ''));
}

function decodeEntities(token) {
  let out = '';
  for (const match of token.matchAll(/&#([xX][0-9a-fA-F]{1,6}|[0-9]{1,7});?/g)) {
    const raw = match[1];
    const value = raw[0] === 'x' || raw[0] === 'X' ? parseInt(raw.slice(1), 16) : Number(raw);
    if (value > 0x10ffff) return '';
    out += String.fromCodePoint(value);
  }
  return out;
}

function decodePercent(token) {
  try {
    return decodeURIComponent(token.replace(/\+/g, ' '));
  } catch {
    return token.replace(PERCENT_SEQUENCE, (seq) =>
      String.fromCharCode(parseInt(seq.slice(1), 16)),
    );
  }
}

function excludedRanges(text) {
  const ranges = [];
  for (const pattern of [JWT, DATA_IMAGE]) {
    for (const match of text.matchAll(pattern)) {
      ranges.push([match.index, match.index + match[0].length]);
    }
  }
  return ranges;
}

function insideRanges(index, ranges) {
  return ranges.some(([start, end]) => index >= start && index < end);
}

function regexCandidates(text, pattern, encoding, decoder, ranges) {
  const out = [];
  for (const match of text.matchAll(pattern)) {
    if (insideRanges(match.index, ranges)) continue;
    out.push({ encoding, original: match[0], decode: () => decoder(match[0]) });
  }
  return out;
}

function percentCandidates(text) {
  const out = [];
  for (const token of text.split(/[\s"'<>]+/)) {
    if (token.length < 18) continue;
    const count = token.match(PERCENT_SEQUENCE)?.length ?? 0;
    if (count < 6) continue;
    out.push({ encoding: 'percent', original: token, decode: () => decodePercent(token) });
  }
  return out;
}

export function findCandidates(text) {
  const ranges = excludedRanges(text);
  return [
    ...regexCandidates(text, BASE64_TOKEN, 'base64', decodeBase64Token, ranges),
    ...regexCandidates(text, HEX_TOKEN, 'hex', decodeHexToken, ranges),
    ...regexCandidates(text, ESCAPED_HEX, 'hex', decodeEscapedHex, ranges),
    ...regexCandidates(text, NUMERIC_ENTITIES, 'html-entities', decodeEntities, ranges),
    ...percentCandidates(text),
  ];
}

function isMostlyPrintableAscii(text) {
  return (
    text.length >= 16 && printableRatio(text) >= 0.98 && !/[^\x09\x0a\x0d\x20-\x7e]/.test(text)
  );
}

export function decodeLayers(text, budget, depth = 1, chain = []) {
  const results = [];
  const state = budget.decodeState ?? (budget.decodeState = { used: 0 });
  for (const candidate of findCandidates(text)) {
    if (budget.expired()) return results;
    const decoded = candidate.decode();
    if (!decoded || decoded === candidate.original) continue;
    state.used += decoded.length;
    if (state.used > budget.limits.maxDecodedBytes) {
      budget.hit('decoded-size');
      return results;
    }
    const nextChain = [...chain, candidate.encoding];
    const readable = looksLikeText(decoded);
    if (readable) {
      results.push({
        encoding: candidate.encoding,
        chain: nextChain,
        original: candidate.original,
        decoded,
      });
    }
    if (!readable && !isMostlyPrintableAscii(decoded)) continue;
    if (depth >= budget.limits.maxDecodeDepth) {
      if (hasReadableLayer(decoded)) budget.hit('decode-depth');
      continue;
    }
    for (const inner of decodeLayers(decoded, budget, depth + 1, nextChain)) {
      results.push({ ...inner, original: candidate.original });
    }
  }
  return results;
}

function hasReadableLayer(text) {
  return findCandidates(text).some((candidate) => {
    const decoded = candidate.decode();
    return decoded && (looksLikeText(decoded) || isMostlyPrintableAscii(decoded));
  });
}
