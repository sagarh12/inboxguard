import { removeAllInvisible } from './unicode.js';

const HOMOGLYPHS = new Map(
  Object.entries({
    а: 'a',
    в: 'b',
    е: 'e',
    ё: 'e',
    к: 'k',
    м: 'm',
    н: 'h',
    о: 'o',
    р: 'p',
    с: 'c',
    т: 't',
    у: 'y',
    х: 'x',
    ѕ: 's',
    і: 'i',
    ї: 'i',
    ј: 'j',
    ԁ: 'd',
    һ: 'h',
    ԛ: 'q',
    ԝ: 'w',
    ӏ: 'l',
    ɡ: 'g',
    α: 'a',
    β: 'b',
    ε: 'e',
    η: 'n',
    ι: 'i',
    κ: 'k',
    ν: 'v',
    ο: 'o',
    ρ: 'p',
    τ: 't',
    υ: 'u',
    χ: 'x',
    ω: 'w',
    ϲ: 'c',
  }),
);

const HOMOGLYPH_PATTERN = new RegExp(`[${[...HOMOGLYPHS.keys()].join('')}]`, 'g');
const LATIN_WITH_MARKS = /(\p{Script=Latin})(\p{M}+)/gu;
const INTRA_WORD_SEPARATORS = /(?<=\p{L})[-_.*~'’`·|]+(?=\p{L})/gu;
const NON_WORD = /[^\p{L}\p{N}\p{M}]+/gu;
const SPACED_LETTERS = /(?<=^| )(?:\p{Script=Latin} ){2,}\p{Script=Latin}(?= |$)/gu;
const NON_ASCII = /[^\x00-\x7f]/;

function mapHomoglyphs(text) {
  return text.replace(HOMOGLYPH_PATTERN, (ch) => HOMOGLYPHS.get(ch));
}

function stripLatinDiacritics(text) {
  return text.normalize('NFD').replace(LATIN_WITH_MARKS, '$1').normalize('NFC');
}

function foldUnicode(text) {
  if (!NON_ASCII.test(text)) return text.toLowerCase();
  const folded = removeAllInvisible(text.normalize('NFKC')).toLowerCase();
  return stripLatinDiacritics(mapHomoglyphs(folded));
}

export function normalizeLight(text) {
  return foldUnicode(String(text ?? ''))
    .replace(/[ \t\f\v\u00a0\u2000-\u200a\u3000]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

export function normalizeSpaced(light) {
  return light
    .replace(INTRA_WORD_SEPARATORS, '')
    .replace(NON_WORD, ' ')
    .trim()
    .replace(SPACED_LETTERS, (run) => run.replace(/ /g, ''));
}

export function normalizeCompact(spaced) {
  return spaced.replace(/ /g, '');
}

export function normalizeForms(text) {
  const light = normalizeLight(text);
  const spaced = normalizeSpaced(light);
  return { light, spaced, compact: normalizeCompact(spaced) };
}
