const IBAN_CANDIDATE = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}/g;
const BIC_CANDIDATE = /\b[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/g;
const NINE_DIGITS = /(?<![\d-])\d{9}(?![\d-])/g;
const CANADIAN_TRANSIT_FIRST = /(?<!\d)(\d{5})[- ](\d{3})[- ](\d{7,12})(?!\d)/g;
const CANADIAN_INSTITUTION_FIRST = /(?<!\d)(\d{3})[- ](\d{5})[- ](\d{7,12})(?!\d)/g;
const CANADIAN_LABELLED =
  /transit\D{0,12}(\d{5})\D{1,40}?institution\D{0,12}(\d{3})|institution\D{0,12}(\d{3})\D{1,40}?transit\D{0,12}(\d{5})/gi;
const INTERAC = /\binterac\b|\be-?transfer\b|\bautodeposit\b/i;
const BTC_LEGACY = /\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\b/g;
const BTC_BECH32 = /\bbc1[ac-hj-np-z02-9]{11,71}\b/gi;
const ETH_ADDRESS = /\b0x[a-fA-F0-9]{40}\b/g;
const TRON_ADDRESS = /\bT[1-9A-HJ-NP-Za-km-z]{33}\b/g;
const AMOUNT =
  /(?:[$€£¥₹]|\b(?:usd|cad|eur|gbp|inr|aud|jpy|chf)\b) ?\d{1,3}(?:[,.]?\d{3})*(?:[.,]\d{1,2})?|\b\d{1,3}(?:[,.]?\d{3})*(?:[.,]\d{1,2})? ?(?:usd|cad|eur|gbp|inr|aud|jpy|chf|dollars|euros|pounds|rupees)\b/gi;
const PAYMENT_WORDS =
  /\b(?:wire transfer|wire|invoice|bank account|account number|routing number|gift ?cards?|remittance|beneficiary|iban|swift|sort code|payment details|bank details|banking details|direct deposit)\b/gi;
const CARD_CANDIDATE = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g;
const ROUTING_CONTEXT = /\b(?:routing|aba|rtn|ach|transit|bank|account|wire)\b/i;
const BIC_CONTEXT = /\b(?:swift|bic|bank|wire|iban)\b/i;

const COUNTRY_CODES = new Set(
  'AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FO FR GA GB GD GE GH GI GL GM GN GQ GR GT GW GY HK HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KI KM KN KP KR KW KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MO MR MT MU MV MW MX MY MZ NA NE NG NI NL NO NP NR NZ OM PA PE PG PH PK PL PS PT PW PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD TG TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VN VU WS XK YE ZA ZM ZW'.split(
    ' ',
  ),
);

export function isValidIban(raw) {
  const iban = raw.replace(/ /g, '').toUpperCase();
  if (iban.length < 15 || iban.length > 34 || !COUNTRY_CODES.has(iban.slice(0, 2))) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const value = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const digit of value) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

export function isValidRoutingNumber(digits) {
  if (!/^\d{9}$/.test(digits)) return false;
  const prefix = Number(digits.slice(0, 2));
  const validPrefix =
    prefix <= 12 ||
    (prefix >= 21 && prefix <= 32) ||
    (prefix >= 61 && prefix <= 72) ||
    prefix === 80;
  if (!validPrefix) return false;
  const d = [...digits].map(Number);
  const sum = 3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8]);
  return sum % 10 === 0;
}

export function passesLuhn(digits) {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = Number(digits[i]);
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return digits.length >= 13 && sum % 10 === 0;
}

function nearby(text, index, length, pattern, radius = 60) {
  return pattern.test(text.slice(Math.max(0, index - radius), index + length + radius));
}

function longestValidIban(candidate) {
  const compact = candidate.replace(/ /g, '');
  for (let length = Math.min(34, compact.length); length >= 15; length -= 1) {
    if (isValidIban(compact.slice(0, length))) return compact.slice(0, length);
  }
  return null;
}

function findIbans(text) {
  return [...text.toUpperCase().matchAll(IBAN_CANDIDATE)]
    .map((m) => longestValidIban(m[0]))
    .filter(Boolean)
    .map((value) => ({ type: 'iban', value }));
}

function findBics(text) {
  return [...text.matchAll(BIC_CANDIDATE)]
    .filter((m) => COUNTRY_CODES.has(m[0].slice(4, 6)))
    .filter((m) => /\d/.test(m[0]) || nearby(text, m.index, m[0].length, BIC_CONTEXT))
    .map((m) => ({ type: 'swift-bic', value: m[0] }));
}

function findRoutingNumbers(text) {
  return [...text.matchAll(NINE_DIGITS)]
    .filter(
      (m) => isValidRoutingNumber(m[0]) && nearby(text, m.index, m[0].length, ROUTING_CONTEXT),
    )
    .map((m) => ({ type: 'us-routing', value: m[0] }));
}

function findCanadianAccounts(text) {
  const hits = [];
  for (const m of text.matchAll(CANADIAN_TRANSIT_FIRST)) {
    hits.push({
      type: 'ca-bank-account',
      value: `transit ${m[1]} institution ${m[2]} account ${m[3]}`,
    });
  }
  for (const m of text.matchAll(CANADIAN_INSTITUTION_FIRST)) {
    hits.push({
      type: 'ca-bank-account',
      value: `institution ${m[1]} transit ${m[2]} account ${m[3]}`,
    });
  }
  for (const m of text.matchAll(CANADIAN_LABELLED)) {
    const transit = m[1] ?? m[4];
    const institution = m[2] ?? m[3];
    hits.push({ type: 'ca-bank-account', value: `transit ${transit} institution ${institution}` });
  }
  return hits;
}

function findCrypto(text) {
  const patterns = [
    ['btc-address', BTC_LEGACY],
    ['btc-address', BTC_BECH32],
    ['eth-address', ETH_ADDRESS],
    ['tron-address', TRON_ADDRESS],
  ];
  return patterns.flatMap(([type, pattern]) =>
    [...text.matchAll(pattern)]
      .filter((m) => /\d/.test(m[0]) && /[a-z]/i.test(m[0]))
      .map((m) => ({ type, value: m[0] })),
  );
}

function countCards(text) {
  let count = 0;
  for (const m of text.matchAll(CARD_CANDIDATE))
    if (passesLuhn(m[0].replace(/[ -]/g, ''))) count += 1;
  return count;
}

export function removeCardNumbers(text) {
  return String(text).replace(CARD_CANDIDATE, (match) =>
    passesLuhn(match.replace(/[ -]/g, '')) ? '[card number removed]' : match,
  );
}

export function scanPaymentText(text) {
  const source = String(text ?? '');
  if (source.length < 3) return emptyScan();
  return {
    accounts: [
      ...findIbans(source),
      ...findBics(source),
      ...findRoutingNumbers(source),
      ...findCanadianAccounts(source),
      ...findCrypto(source),
    ],
    amounts: [...source.matchAll(AMOUNT)].map((m) => m[0].trim()),
    paymentWords: [...new Set([...source.matchAll(PAYMENT_WORDS)].map((m) => m[0].toLowerCase()))],
    interac: INTERAC.test(source),
    cardCount: countCards(source),
  };
}

function emptyScan() {
  return { accounts: [], amounts: [], paymentWords: [], interac: false, cardCount: 0 };
}

export function mergeScans(scans) {
  const merged = emptyScan();
  const seenAccounts = new Set();
  for (const scan of scans) {
    for (const account of scan.accounts) {
      const key = `${account.type}:${account.value}`;
      if (seenAccounts.has(key)) continue;
      seenAccounts.add(key);
      merged.accounts.push(account);
    }
    merged.amounts.push(...scan.amounts.filter((a) => !merged.amounts.includes(a)));
    merged.paymentWords.push(...scan.paymentWords.filter((w) => !merged.paymentWords.includes(w)));
    merged.interac ||= scan.interac;
    merged.cardCount += scan.cardCount;
  }
  return merged;
}

export function hasPaymentSignal(scan) {
  return (
    scan.accounts.length > 0 ||
    scan.amounts.length > 0 ||
    scan.paymentWords.length > 0 ||
    scan.interac ||
    scan.cardCount > 0
  );
}

function normalizeAccount(value) {
  return String(value).replace(/[\s-]/g, '').toUpperCase();
}

export function comparePayees(scan, allText, emails, payees) {
  const flags = [];
  const list = Array.isArray(payees?.payees) ? payees.payees : [];
  const lowerText = allText.toLowerCase();
  const knownAccounts = new Set(list.flatMap((p) => (p.accounts ?? []).map(normalizeAccount)));
  const mentioned = list.filter((p) => p.name && lowerText.includes(String(p.name).toLowerCase()));
  for (const account of scan.accounts) {
    const normalized = normalizeAccount(account.value);
    const accountKnown = [...knownAccounts].some(
      (known) => normalized.includes(known) || known.includes(normalized),
    );
    if (accountKnown) continue;
    if (mentioned.length > 0) {
      for (const payee of mentioned) {
        flags.push({
          flag: 'payee-account-mismatch',
          payee: payee.name,
          account: account.value,
          type: account.type,
        });
      }
    } else {
      flags.push({ flag: 'new-payment-details', account: account.value, type: account.type });
    }
  }
  for (const payee of mentioned) {
    const domains = (payee.domains ?? []).map((d) => String(d).toLowerCase());
    const known = (payee.emails ?? []).map((e) => String(e).toLowerCase());
    for (const email of emails) {
      const domain = email.split('@')[1];
      if (known.includes(email) || domains.includes(domain)) continue;
      flags.push({ flag: 'payee-email-mismatch', payee: payee.name, email });
    }
  }
  return flags;
}
