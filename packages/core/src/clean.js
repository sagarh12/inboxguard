export function normalizeWhitespace(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function buildCleanedText(invisibleAnalysis) {
  return normalizeWhitespace(invisibleAnalysis?.cleaned ?? '');
}
