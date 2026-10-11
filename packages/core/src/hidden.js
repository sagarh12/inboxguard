import { parseDocument } from 'htmlparser2';
import { selectAll } from 'css-select';
import parseCss from 'css-tree/parser';
import walkCss from 'css-tree/walker';
import {
  parseColor,
  colorFromBackground,
  colorsNearlyEqual,
  blendOver,
  WHITE,
  BLACK,
} from './colors.js';

const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'center',
  'dd',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'tbody',
  'thead',
  'tfoot',
  'tr',
  'ul',
  'body',
  'html',
]);
const CELL_TAGS = new Set(['td', 'th']);
const CARRIER_ELEMENTS = new Set(['noscript', 'template', 'textarea']);
const SVG_CARRIERS = new Set(['desc', 'title', 'text', 'textpath', 'tspan']);
const SEMI_VISIBLE_ATTRIBUTES = ['alt', 'title', 'aria-label', 'aria-description', 'placeholder'];
const URL_ATTRIBUTES = ['href', 'src', 'background', 'action', 'poster', 'srcset'];
const DYNAMIC_PSEUDO = /:(?:hover|focus|active|visited|focus-within|focus-visible|target)\b|::/i;

const FONT_KEYWORDS = {
  'xx-small': 9,
  'x-small': 10,
  small: 13,
  medium: 16,
  large: 18,
  'x-large': 24,
  'xx-large': 32,
  'xxx-large': 48,
};

export function parseLengthPx(raw, fontPx = 16) {
  if (raw === undefined || raw === null) return null;
  const match = /^(-?\d*\.?\d+)(px|pt|pc|em|rem|ex|ch|%|vw|vh|cm|mm|in|q)?$/i.exec(
    String(raw).trim(),
  );
  if (!match) return null;
  const value = parseFloat(match[1]);
  const unit = (match[2] ?? '').toLowerCase();
  const factors = {
    '': value === 0 ? 1 : null,
    px: 1,
    pt: 4 / 3,
    pc: 16,
    em: fontPx,
    rem: 16,
    ex: fontPx / 2,
    ch: fontPx / 2,
    '%': fontPx / 100,
    cm: 37.8,
    mm: 3.78,
    in: 96,
    q: 0.945,
    vw: 10,
    vh: 10,
  };
  const factor = factors[unit];
  return factor === null || factor === undefined ? null : value * factor;
}

function parseFontSizePx(raw, parentPx) {
  if (!raw) return null;
  const text = raw.trim().toLowerCase();
  if (FONT_KEYWORDS[text]) return FONT_KEYWORDS[text];
  if (text === 'smaller') return parentPx / 1.2;
  if (text === 'larger') return parentPx * 1.2;
  if (text === '0') return 0;
  const px = parseLengthPx(text, parentPx);
  return px === null ? null : Math.max(0, px);
}

function fontShorthandParts(raw) {
  if (!raw) return {};
  for (const token of raw.trim().toLowerCase().split(/\s+/)) {
    const match =
      /^(\d*\.?\d+(?:px|pt|em|rem|%|ex)?|xx-small|x-small|small|medium|large|x-large|xx-large)(?:\/(\S+))?$/.exec(
        token,
      );
    if (!match) continue;
    const isBareNonZero = /^\d*\.?\d+$/.test(match[1]) && parseFloat(match[1]) !== 0;
    if (isBareNonZero && !match[2]) continue;
    return { size: match[1], lineHeight: match[2] };
  }
  return {};
}

function isZeroLength(raw) {
  if (!raw) return false;
  const px = parseLengthPx(raw);
  return px !== null && px <= 0;
}

function parseInlineStyle(style) {
  const declarations = [];
  if (!style) return declarations;
  for (const part of style.split(';')) {
    const colon = part.indexOf(':');
    if (colon === -1) continue;
    const property = part.slice(0, colon).trim().toLowerCase();
    let value = part.slice(colon + 1).trim();
    const important = /!\s*important\s*$/i.test(value);
    if (important) value = value.replace(/!\s*important\s*$/i, '').trim();
    if (property) declarations.push({ property, value: value.toLowerCase(), important });
  }
  return declarations;
}

function selectorSpecificity(selector) {
  const ids = (selector.match(/#[\w-]+/g) ?? []).length;
  const classes = (selector.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) ?? []).length;
  const types = (selector.match(/(?:^|[\s>+~(])[a-z][\w-]*/gi) ?? []).length;
  return ids * 10000 + classes * 100 + types;
}

function splitSelectorList(prelude) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of prelude) {
    if (ch === '(' || ch === '[') depth += 1;
    if (ch === ')' || ch === ']') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function extractCssComments(css) {
  const comments = [];
  let index = css.indexOf('/*');
  while (index !== -1) {
    const end = css.indexOf('*/', index + 2);
    comments.push(css.slice(index + 2, end === -1 ? css.length : end));
    if (end === -1) break;
    index = css.indexOf('/*', end + 2);
  }
  return comments;
}

function collectNodes(root, predicate) {
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (predicate(node)) out.push(node);
    if (node.children)
      for (let i = node.children.length - 1; i >= 0; i -= 1) stack.push(node.children[i]);
  }
  return out;
}

export function textContent(node) {
  let out = '';
  const stack = [node];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current.type === 'text' || current.type === 'cdata') out += current.data ?? '';
    if (current.type === 'comment') continue;
    if (current.children)
      for (let i = current.children.length - 1; i >= 0; i -= 1) stack.push(current.children[i]);
  }
  return out;
}

function safeSelectAll(selector, dom) {
  try {
    return selectAll(selector, dom);
  } catch {
    return [];
  }
}

function buildStyleIndex(dom, budget, carriers) {
  const index = new Map();
  const styleNodes = collectNodes(dom, (node) => node.type === 'style' || node.name === 'style');
  let order = 0;
  let ruleCount = 0;
  for (const styleNode of styleNodes) {
    const css = textContent(styleNode);
    for (const comment of extractCssComments(css)) {
      carriers.push({
        kind: 'style-comment',
        text: comment,
        where: '<style> comment',
        context: 'hidden',
      });
    }
    let ast;
    try {
      ast = parseCss(css, {
        parseRulePrelude: false,
        parseValue: false,
        parseAtrulePrelude: false,
        onParseError: () => {},
      });
    } catch {
      continue;
    }
    walkCss(ast, {
      visit: 'Rule',
      enter(rule) {
        ruleCount += 1;
        if (ruleCount > budget.limits.maxStyleRules) {
          budget.hit('style-rules');
          return;
        }
        if (budget.expired()) return;
        const prelude = String(rule.prelude?.value ?? '').trim();
        const declarations = (rule.block?.children?.toArray?.() ?? [])
          .filter((d) => d.type === 'Declaration')
          .map((d) => ({
            property: d.property.toLowerCase(),
            value: String(d.value?.value ?? '')
              .trim()
              .toLowerCase(),
            important: Boolean(d.important),
          }));
        for (const declaration of declarations) {
          if (
            declaration.property === 'content' &&
            /[a-z]{3,}\s+[a-z]{3,}/i.test(declaration.value)
          ) {
            carriers.push({
              kind: 'style-content',
              text: declaration.value,
              where: `<style> ${prelude}`,
              context: 'hidden',
            });
          }
        }
        for (const selector of splitSelectorList(prelude)) {
          order += 1;
          if (DYNAMIC_PSEUDO.test(selector)) continue;
          const matched = safeSelectAll(selector, dom);
          const specificity = selectorSpecificity(selector);
          for (const element of matched) {
            const list = index.get(element) ?? [];
            for (const declaration of declarations)
              list.push({ ...declaration, specificity, order, inline: false });
            index.set(element, list);
          }
        }
      },
    });
  }
  return index;
}

function presentationalHints(element) {
  const hints = [];
  const attrs = element.attribs ?? {};
  if (attrs.bgcolor)
    hints.push({ property: 'background-color', value: attrs.bgcolor.toLowerCase() });
  if (element.name === 'font' && attrs.color)
    hints.push({ property: 'color', value: attrs.color.toLowerCase() });
  if (element.name === 'font' && attrs.size && /^0$/.test(attrs.size.trim()))
    hints.push({ property: 'font-size', value: '0' });
  return hints;
}

function resolveDeclarations(element, styleIndex) {
  const resolved = new Map();
  for (const hint of presentationalHints(element)) resolved.set(hint.property, hint.value);
  const sheet = styleIndex.get(element) ?? [];
  const inline = parseInlineStyle(element.attribs?.style).map((d, i) => ({
    ...d,
    specificity: 0,
    order: i,
    inline: true,
  }));
  const rank = (d) => (d.important ? 2 : 0) + (d.inline ? 1 : 0);
  const ordered = [...sheet, ...inline].sort(
    (a, b) => rank(a) - rank(b) || a.specificity - b.specificity || a.order - b.order,
  );
  for (const declaration of ordered) resolved.set(declaration.property, declaration.value);
  return resolved;
}

function subtreeHidingReason(element, decls, state) {
  const attrs = element.attribs ?? {};
  if ('hidden' in attrs) return 'hidden attribute';
  const display = decls.get('display');
  if (display === 'none') return 'display:none';
  if ((decls.get('mso-hide') ?? '').startsWith('all')) return 'mso-hide:all';
  if (state.opacity <= 0.05) return 'opacity';
  const transform = decls.get('transform') ?? '';
  if (/scale[xy3d]?\(\s*0*\.?0+\s*(?:[,)])/.test(transform)) return 'transform:scale(0)';
  if (isZeroLength(decls.get('max-height'))) return 'max-height:0';
  const overflowHidden =
    /hidden|clip/.test(decls.get('overflow') ?? '') ||
    /hidden|clip/.test(decls.get('overflow-y') ?? '') ||
    /hidden|clip/.test(decls.get('overflow-x') ?? '');
  const zeroBox =
    isZeroLength(decls.get('height')) ||
    isZeroLength(decls.get('width')) ||
    isZeroLength(decls.get('max-width'));
  if (zeroBox && overflowHidden) return 'zero size with overflow hidden';
  const clip = decls.get('clip');
  if (clip && clip !== 'auto') return 'clip';
  const clipPath = decls.get('clip-path');
  if (clipPath && clipPath !== 'none' && !/^inset\(\s*0(?:px)?\s*\)$/.test(clipPath))
    return 'clip-path';
  const indent = parseLengthPx(decls.get('text-indent'), state.fontPx);
  if (indent !== null && indent <= -999) return 'text-indent';
  const position = decls.get('position');
  if (position === 'absolute' || position === 'fixed') {
    const left = parseLengthPx(decls.get('left'), state.fontPx);
    const top = parseLengthPx(decls.get('top'), state.fontPx);
    if ((left !== null && left <= -999) || (top !== null && top <= -999))
      return 'positioned off screen';
  }
  return null;
}

function inheritedHidingReason(state) {
  if (state.visibility === 'hidden') return 'visibility:hidden';
  if (state.fontPx <= 1) return 'font-size';
  if (state.lineHeightZero) return 'line-height:0';
  if (state.bg && colorsNearlyEqual(state.color, state.bg)) return 'text color matches background';
  return null;
}

function nextState(element, decls, parent) {
  const font = fontShorthandParts(decls.get('font'));
  const fontPx =
    parseFontSizePx(decls.get('font-size') ?? font.size, parent.fontPx) ?? parent.fontPx;
  const ownColor = parseColor(decls.get('color'));
  const background = colorFromBackground(decls.get('background-color') ?? decls.get('background'));
  let bg = parent.bg;
  if (background === undefined) bg = undefined;
  else if (background)
    bg = parent.bg ? blendOver(background, parent.bg) : background.a >= 1 ? background : undefined;
  const visibilityValue = decls.get('visibility');
  const visibility =
    visibilityValue === 'hidden' || visibilityValue === 'collapse'
      ? 'hidden'
      : visibilityValue === 'visible'
        ? 'visible'
        : parent.visibility;
  const lineHeightRaw = decls.get('line-height') ?? font.lineHeight;
  const lineHeightZero =
    lineHeightRaw === undefined
      ? parent.lineHeightZero
      : isZeroLength(lineHeightRaw) || lineHeightRaw === '0';
  const opacityValue = parseFloat(decls.get('opacity'));
  const opacity =
    parent.opacity * (Number.isNaN(opacityValue) ? 1 : Math.max(0, Math.min(1, opacityValue)));
  return {
    fontPx,
    color: ownColor ?? parent.color,
    bg,
    visibility,
    lineHeightZero,
    opacity,
    cause: parent.cause,
  };
}

function parseDimension(raw) {
  if (raw === undefined) return null;
  const text = String(raw).trim();
  return /^\d+(?:\.\d+)?$/.test(text) ? parseFloat(text) : parseLengthPx(text);
}

function isTrackingPixel(element, decls) {
  const attrs = element.attribs ?? {};
  const width = parseDimension(attrs.width ?? decls.get('width'));
  const height = parseDimension(attrs.height ?? decls.get('height'));
  return (width !== null && width <= 1) || (height !== null && height <= 1);
}

function stripMarkup(text) {
  return text.replace(/<[^<>]{0,1000}>/g, ' ');
}

function hostOf(href) {
  const match = /^https?:\/\/([^/?#:\s]+)/i.exec(href ?? '');
  return match ? match[1].toLowerCase() : '';
}

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);
const TAG_TOKEN = /<(\/?)([a-zA-Z][\w:-]*)[^>]*>/g;

export function flattenExcessNesting(html, maxDepth) {
  let depth = 0;
  let exceeded = false;
  const flattened = html.replace(TAG_TOKEN, (token, closing, rawName) => {
    const name = rawName.toLowerCase();
    if (VOID_TAGS.has(name) || token.endsWith('/>')) return depth >= maxDepth ? ' ' : token;
    if (closing) {
      depth = Math.max(0, depth - 1);
      return depth >= maxDepth ? ' ' : token;
    }
    depth += 1;
    if (depth <= maxDepth) return token;
    exceeded = true;
    return ' ';
  });
  return { html: exceeded ? flattened : html, exceeded };
}

export function analyzeHtml(html, budget) {
  const nesting = flattenExcessNesting(String(html ?? ''), budget.limits.maxDomDepth * 2);
  if (nesting.exceeded) budget.hit('dom-depth');
  const dom = parseDocument(nesting.html, {
    decodeEntities: true,
    lowerCaseTags: true,
    lowerCaseAttributeNames: true,
  });
  const carriers = [];
  const urls = [];
  const styleIndex = buildStyleIndex(dom, budget, carriers);
  const visibleParts = [];
  const segments = new Map();
  let visibleChars = 0;
  let nodeCount = 0;
  let causeId = 0;

  const emit = (state, text) => {
    if (!text) return;
    if (state.cause) {
      segments.get(state.cause.id).parts.push(text);
      return;
    }
    visibleParts.push(text);
    visibleChars += text.replace(/\s+/g, '').length;
  };

  const newCause = (reason, element, subtree) => {
    causeId += 1;
    const cause = { id: causeId, reason, tag: element.name, early: visibleChars < 300, subtree };
    segments.set(causeId, { ...cause, parts: [] });
    return cause;
  };

  const resolveCause = (element, decls, parentState, state) => {
    if (parentState.cause?.subtree) return parentState.cause;
    const subtreeReason = subtreeHidingReason(element, decls, state);
    if (subtreeReason) return newCause(subtreeReason, element, true);
    const inherited = inheritedHidingReason(state);
    if (!inherited) return null;
    if (parentState.cause?.reason === inherited) return parentState.cause;
    return newCause(inherited, element, false);
  };

  const recordAttributes = (element, state) => {
    const attrs = element.attribs ?? {};
    for (const [name, value] of Object.entries(attrs)) {
      if (!value) continue;
      if (URL_ATTRIBUTES.includes(name)) urls.push({ attribute: name, value, tag: element.name });
      const where = `<${element.name} ${name}>`;
      if (SEMI_VISIBLE_ATTRIBUTES.includes(name)) {
        carriers.push({
          kind: 'attribute',
          text: value,
          where,
          context: state.cause ? 'hidden' : 'semi',
        });
      } else if (name.startsWith('data-')) {
        carriers.push({ kind: 'data-attribute', text: value, where, context: 'hidden' });
      }
    }
    if (element.name === 'meta' && attrs.content)
      carriers.push({
        kind: 'meta',
        text: attrs.content,
        where: '<meta content>',
        context: 'hidden',
      });
    if (element.name === 'input' && (attrs.type ?? '').toLowerCase() === 'hidden' && attrs.value) {
      carriers.push({
        kind: 'hidden-input',
        text: attrs.value,
        where: '<input type=hidden>',
        context: 'hidden',
      });
    }
  };

  const flattenDeep = (node, state) => {
    budget.hit('dom-depth');
    emit(state, textContent(node));
  };

  const visit = (node, state, depth, inSvg) => {
    nodeCount += 1;
    if ((nodeCount & 255) === 0 && budget.expired()) return false;
    if (node.type === 'text' || node.type === 'cdata') {
      if (node.type === 'text') emit(state, node.data);
      else
        for (const child of node.children ?? []) if (child.type === 'text') emit(state, child.data);
      return true;
    }
    if (node.type === 'comment') {
      const data = node.data ?? '';
      const conditional = /^\s*\[(?:if|endif)\b|<!\[endif\]\s*$/i.test(data);
      carriers.push({
        kind: 'comment',
        text: stripMarkup(data),
        where: conditional ? 'conditional comment' : 'html comment',
        context: 'hidden',
        conditional,
      });
      return true;
    }
    if (node.type === 'script') {
      carriers.push({
        kind: 'script',
        text: textContent(node),
        where: '<script>',
        context: 'hidden',
      });
      return true;
    }
    if (node.type === 'style') return true;
    if (node.type !== 'tag') {
      for (const child of node.children ?? [])
        if (visit(child, state, depth + 1, inSvg) === false) return false;
      return true;
    }
    if (depth > budget.limits.maxDomDepth) {
      flattenDeep(node, state);
      return true;
    }
    const name = node.name;
    const decls = resolveDeclarations(node, styleIndex);
    const childState = nextState(node, decls, state);
    childState.cause = resolveCause(node, decls, state, childState);
    if (name === 'img' && isTrackingPixel(node, decls)) return true;
    recordAttributes(node, childState);
    if (name === 'head') {
      for (const child of collectNodes(node, (n) => n.name === 'title' || n.name === 'meta')) {
        if (child.name === 'title')
          carriers.push({
            kind: 'title',
            text: textContent(child),
            where: '<title>',
            context: 'hidden',
          });
        else recordAttributes(child, childState);
      }
      return true;
    }
    if (CARRIER_ELEMENTS.has(name)) {
      carriers.push({ kind: name, text: textContent(node), where: `<${name}>`, context: 'hidden' });
      return true;
    }
    const svg = inSvg || name === 'svg';
    if (svg && SVG_CARRIERS.has(name)) {
      carriers.push({
        kind: `svg-${name}`,
        text: textContent(node),
        where: `<svg ${name}>`,
        context: 'hidden',
      });
      return true;
    }
    if (name === 'img') return true;
    if (name === 'br') {
      emit(childState, '\n');
      return true;
    }
    const block = BLOCK_TAGS.has(name);
    if (block) emit(childState, '\n');
    for (const child of node.children ?? [])
      if (visit(child, childState, depth + 1, svg) === false) return false;
    if (name === 'a' && !childState.cause) {
      const host = hostOf(node.attribs?.href);
      const label = textContent(node).toLowerCase();
      if (host && !label.includes(host)) emit(childState, ` (${host})`);
    }
    if (block) emit(childState, '\n');
    if (CELL_TAGS.has(name)) emit(childState, ' ');
    return true;
  };

  const rootState = {
    fontPx: 16,
    color: BLACK,
    bg: WHITE,
    visibility: 'visible',
    lineHeightZero: false,
    opacity: 1,
    cause: null,
  };
  const completed = visit(dom, rootState, 0, false) !== false;
  const hiddenSegments = [...segments.values()]
    .map((segment) => ({
      text: segment.parts.join(''),
      reason: segment.reason,
      tag: segment.tag,
      early: segment.early,
    }))
    .filter(
      (segment) =>
        /[\p{L}\p{N}]/u.test(segment.text) ||
        /[\u200b-\u200d\u2060\ufeff\u{e0000}-\u{e007f}]/u.test(segment.text),
    );
  return { visibleText: visibleParts.join(''), hiddenSegments, carriers, urls, completed };
}
