import { findInboxRows, describeRow } from './selectors.js';

const ROW_ATTRIBUTE = 'data-inboxguard-row';
const STYLE_ID = 'inboxguard-row-style';
const ROW_LABEL =
  'inboxguard: this email may contain instructions aimed at AI assistants. Open it to check.';
const ROW_STYLE = `
[${ROW_ATTRIBUTE}="red"] { background-color: rgba(217, 45, 32, 0.1) !important; }
tr[${ROW_ATTRIBUTE}="red"] > td:first-child, div[${ROW_ATTRIBUTE}="red"] { box-shadow: inset 5px 0 0 #d92d20 !important; }
`;

function ensureStyle(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = ROW_STYLE;
  (doc.head ?? doc.documentElement).append(style);
}

function markRow(row) {
  row.setAttribute(ROW_ATTRIBUTE, 'red');
  row.setAttribute('title', ROW_LABEL);
  row.setAttribute('aria-description', ROW_LABEL);
}

function unmarkRow(row) {
  if (!row.hasAttribute(ROW_ATTRIBUTE)) return;
  row.removeAttribute(ROW_ATTRIBUTE);
  row.removeAttribute('title');
  row.removeAttribute('aria-description');
}

export function createRowMarker({ document: doc, site, inspect }) {
  const signatures = new WeakMap();
  const knownRed = new Set();

  const rowIsRed = ({ id, text }) => {
    if (id && knownRed.has(id)) return true;
    return Boolean(text) && inspect({ text }).verdict !== 'clean';
  };

  return {
    rememberRed(id) {
      if (id) knownRed.add(id);
    },

    markRows() {
      const rows = findInboxRows(doc, site);
      if (rows.length === 0) return 0;
      ensureStyle(doc);
      let marked = 0;
      for (const row of rows) {
        const description = describeRow(row, site);
        const signature = `${description.id}|${knownRed.has(description.id)}|${description.text}`;
        if (signatures.get(row) === signature) {
          if (row.hasAttribute(ROW_ATTRIBUTE)) marked += 1;
          continue;
        }
        signatures.set(row, signature);
        if (rowIsRed(description)) {
          markRow(row);
          marked += 1;
        } else {
          unmarkRow(row);
        }
      }
      return marked;
    },

    clear() {
      for (const row of findInboxRows(doc, site)) unmarkRow(row);
    },
  };
}
