import en from '../rules/en.json' with { type: 'json' };
import hi from '../rules/hi.json' with { type: 'json' };
import fr from '../rules/fr.json' with { type: 'json' };
import es from '../rules/es.json' with { type: 'json' };
import de from '../rules/de.json' with { type: 'json' };
import pt from '../rules/pt.json' with { type: 'json' };
import zh from '../rules/zh.json' with { type: 'json' };
import { normalizeForms } from './normalize.js';

export const RULE_SETS = [en, hi, fr, es, de, pt, zh];

export const CATEGORY_WEIGHTS = Object.freeze({
  override: 3,
  'role-marker': 3,
  'addressing-ai': 2,
  concealment: 2,
  steering: 2,
  'money-data': 2,
  'code-poisoning': 3,
  exfiltration: 3,
});

const MARKDOWN_LINK = /(!?)\[([^\]\n]{0,200})\]\(\s*(https?:\/\/[^\s)]{1,2000})\s*\)/g;
const PLACEHOLDER =
  /[{}<>[\]]|%7b|%7d|%3c|%3e|\$[a-z_]|\b(?:insert|replace|summary|conversation|secret|token|password|api_?key|history|prompt|chat|context|credentials?|ssn|data_here|user_?data)\b/i;

function compileRule(rule, language) {
  return {
    id: rule.id,
    category: rule.category,
    language,
    form: rule.form ?? 'spaced',
    regexes: (rule.patterns ?? []).map((source) => new RegExp(source.normalize('NFKC'), 'u')),
    compact: (rule.compact ?? []).map((phrase) => phrase.normalize('NFKC')),
  };
}

export function compileRuleSets(sets) {
  return sets.flatMap((set) => set.rules.map((rule) => compileRule(rule, set.language)));
}

const DEFAULT_RULES = compileRuleSets(RULE_SETS);

function matchRule(rule, forms) {
  const target = rule.form === 'light' ? forms.light : forms.spaced;
  for (const regex of rule.regexes) {
    const found = regex.exec(target);
    if (found) return found[0];
  }
  for (const phrase of rule.compact) if (forms.compact.includes(phrase)) return phrase;
  return null;
}

export function findExfiltrationLinks(text) {
  const hits = [];
  for (const match of String(text ?? '').matchAll(MARKDOWN_LINK)) {
    const url = match[3];
    const queryStart = url.indexOf('?');
    if (queryStart === -1) continue;
    const query = url.slice(queryStart + 1);
    if (!PLACEHOLDER.test(query) && !(match[1] === '!' && /=[^&]{1,}/.test(query))) continue;
    hits.push({ markdown: match[0], url, image: match[1] === '!' });
  }
  return hits;
}

export function detectInstructions(text, options = {}) {
  const { rules = DEFAULT_RULES, budget } = options;
  const source = String(text ?? '');
  if (!source.trim() || budget?.expired()) return emptyDetection();
  const forms = normalizeForms(source);
  const matches = [];
  for (const rule of rules) {
    if (budget?.expired()) break;
    const matched = matchRule(rule, forms);
    if (matched)
      matches.push({ rule: rule.id, category: rule.category, language: rule.language, matched });
  }
  for (const link of findExfiltrationLinks(source)) {
    matches.push({
      rule: 'exfiltration.markdown-link',
      category: 'exfiltration',
      language: 'any',
      matched: link.url,
    });
  }
  return summarize(matches);
}

function emptyDetection() {
  return { matches: [], categories: new Set(), score: 0 };
}

function summarize(matches) {
  const categories = new Set(matches.map((m) => m.category));
  let score = 0;
  for (const category of categories) score += CATEGORY_WEIGHTS[category] ?? 1;
  return { matches, categories, score };
}

export function isAddressedToAi(detection) {
  return detection.categories.has('addressing-ai') && detection.categories.size >= 2;
}
