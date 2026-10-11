# Design

## Layout

```
packages/core       engine, no network, no filesystem, runs in Node and browser
packages/proxy      MCP proxy over stdio, uses core
packages/extension  Chrome MV3 content script, bundles core with esbuild
fixtures            attack and benign emails with expected verdicts
scripts             style checker, bench, fixture generator, mock upstream, icon generator
```

## inspectEmail

1. Cap each input field so the total stays under 5 MB. Uint8Array input is decoded as UTF-8 without failing on bad bytes.
2. HTML goes to `hidden.js`. Nesting deeper than twice the DOM depth limit is flattened before parsing, because htmlparser2 slows down sharply on very deep trees. Style sheets are parsed with css-tree, including `@media` blocks. Selectors are matched with css-select. Declarations are applied in order of importance, inline origin, specificity and source order.
3. The walker tracks inherited state: font size in pixels, text color, effective background, visibility, line height and an opacity product. A node starts a hidden segment when one of the hiding rules applies. Text under it goes to that segment instead of the visible text.
4. Comments, `alt`, `title`, `aria-label`, `data-*`, `<meta content>`, hidden inputs, `noscript`, `template`, `textarea`, SVG text, style comments, CSS `content` and scripts are collected as carriers. Tracking pixels are skipped. Images are never described.
5. Each piece of text is inspected for instructions (`detect.js`), invisible characters (`unicode.js`) and encodings (`decode.js`). Hidden segments are also inspected together, which catches an instruction split across several hidden elements.
6. `verdict.js` turns observations into findings and a verdict.

| Observation | Severity |
| --- | --- |
| Hidden text, comment or carrier with instruction-like content | high |
| Decoded payload with instruction-like content | high |
| Smuggled Unicode payload with instruction-like content | high |
| `alt`, `title` or `aria-label` with instructions addressed to an AI | high |
| Same, not addressed to an AI | medium |
| Visible text addressed to an AI with another instruction category | medium |
| Markdown link or image with data in the query string | medium |
| Invisible-character abuse | medium, or low for one isolated character |
| Any limit reached, or internal failure | medium |
| Hidden text without instructions | low |
| Preheader: short hidden text near the top | info |
| Visible instruction phrases not addressed to an AI | info |

The verdict follows the highest severity: high is `malicious`, medium is `suspicious`, anything else is `clean`.

`cleanedText` is the visible text with abusive invisible characters removed, whitespace normalized and links shown as text plus host.

## Normalization

Rules match on three forms of the text:

- light: NFKC, lowercase, invisible characters removed, homoglyphs mapped, Latin diacritics removed. Used for role markers, code snippets and Chinese.
- spaced: light form with separators inside words removed, other punctuation turned into spaces, and runs of single letters joined.
- compact: spaced form without spaces. Used only for a few long phrases, to catch letters split by spaces.

ASCII-only text skips the Unicode steps, which keeps 5 MB inputs inside the time budget.

## evaluateAction

1. Tool names are split into words, with camelCase and snake_case both handled.
2. A tool is read-only when it matches a read word and no write word.
3. Categories are checked in order of decision strength. Only `credentials` applies to read-only tools.
4. Every argument string is scanned for payment details. Account numbers, amounts and cards raise any decision to `approve`. Payment words and Interac language do this for write tools only.
5. A tainted session raises every write to `approve`.
6. The strongest decision wins: deny, then approve, then allow.

## Proxy call flow

```
AI client -> tools/call -> gate
  deny    -> error result, audit
  approve -> approval store
              approved for this hash -> consume -> forward
              rejected or expired    -> "Rejected by user"
              otherwise              -> create or reuse pending, start page, notify -> "approval required"
  allow   -> forward
forward -> upstream request with timeout -> sanitize -> taint session if flagged -> audit -> AI client
```

The approval page is an HTTP server on 127.0.0.1 with a random port. It starts when first needed. GET needs the per-approval token. POST needs a matching Origin, a JSON content type and the CSRF token in a header and in the body.

## Extension flow

A debounced MutationObserver finds message bodies with the selectors in `selectors.js`. Each body is scanned once, tracked in a WeakSet. The HTML of the body goes to `inspectEmail`. The banner sits in a closed shadow root above the body. When neutralizing, the content script uses the browser's computed styles to find hidden elements. It clears their text, clears comments, strips abusive invisible characters, and marks changed nodes with `data-inboxguard-neutralized`. No element is removed. All errors are caught and logged with `console.debug`.
