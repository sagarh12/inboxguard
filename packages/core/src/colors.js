const NAMED_COLORS = {
  aliceblue: 'f0f8ff',
  antiquewhite: 'faebd7',
  aqua: '00ffff',
  aquamarine: '7fffd4',
  azure: 'f0ffff',
  beige: 'f5f5dc',
  bisque: 'ffe4c4',
  black: '000000',
  blanchedalmond: 'ffebcd',
  blue: '0000ff',
  blueviolet: '8a2be2',
  brown: 'a52a2a',
  burlywood: 'deb887',
  cadetblue: '5f9ea0',
  chartreuse: '7fff00',
  chocolate: 'd2691e',
  coral: 'ff7f50',
  cornflowerblue: '6495ed',
  cornsilk: 'fff8dc',
  crimson: 'dc143c',
  cyan: '00ffff',
  darkblue: '00008b',
  darkcyan: '008b8b',
  darkgoldenrod: 'b8860b',
  darkgray: 'a9a9a9',
  darkgreen: '006400',
  darkgrey: 'a9a9a9',
  darkkhaki: 'bdb76b',
  darkmagenta: '8b008b',
  darkolivegreen: '556b2f',
  darkorange: 'ff8c00',
  darkorchid: '9932cc',
  darkred: '8b0000',
  darksalmon: 'e9967a',
  darkseagreen: '8fbc8f',
  darkslateblue: '483d8b',
  darkslategray: '2f4f4f',
  darkslategrey: '2f4f4f',
  darkturquoise: '00ced1',
  darkviolet: '9400d3',
  deeppink: 'ff1493',
  deepskyblue: '00bfff',
  dimgray: '696969',
  dimgrey: '696969',
  dodgerblue: '1e90ff',
  firebrick: 'b22222',
  floralwhite: 'fffaf0',
  forestgreen: '228b22',
  fuchsia: 'ff00ff',
  gainsboro: 'dcdcdc',
  ghostwhite: 'f8f8ff',
  gold: 'ffd700',
  goldenrod: 'daa520',
  gray: '808080',
  green: '008000',
  greenyellow: 'adff2f',
  grey: '808080',
  honeydew: 'f0fff0',
  hotpink: 'ff69b4',
  indianred: 'cd5c5c',
  indigo: '4b0082',
  ivory: 'fffff0',
  khaki: 'f0e68c',
  lavender: 'e6e6fa',
  lavenderblush: 'fff0f5',
  lawngreen: '7cfc00',
  lemonchiffon: 'fffacd',
  lightblue: 'add8e6',
  lightcoral: 'f08080',
  lightcyan: 'e0ffff',
  lightgoldenrodyellow: 'fafad2',
  lightgray: 'd3d3d3',
  lightgreen: '90ee90',
  lightgrey: 'd3d3d3',
  lightpink: 'ffb6c1',
  lightsalmon: 'ffa07a',
  lightseagreen: '20b2aa',
  lightskyblue: '87cefa',
  lightslategray: '778899',
  lightslategrey: '778899',
  lightsteelblue: 'b0c4de',
  lightyellow: 'ffffe0',
  lime: '00ff00',
  limegreen: '32cd32',
  linen: 'faf0e6',
  magenta: 'ff00ff',
  maroon: '800000',
  mediumaquamarine: '66cdaa',
  mediumblue: '0000cd',
  mediumorchid: 'ba55d3',
  mediumpurple: '9370db',
  mediumseagreen: '3cb371',
  mediumslateblue: '7b68ee',
  mediumspringgreen: '00fa9a',
  mediumturquoise: '48d1cc',
  mediumvioletred: 'c71585',
  midnightblue: '191970',
  mintcream: 'f5fffa',
  mistyrose: 'ffe4e1',
  moccasin: 'ffe4b5',
  navajowhite: 'ffdead',
  navy: '000080',
  oldlace: 'fdf5e6',
  olive: '808000',
  olivedrab: '6b8e23',
  orange: 'ffa500',
  orangered: 'ff4500',
  orchid: 'da70d6',
  palegoldenrod: 'eee8aa',
  palegreen: '98fb98',
  paleturquoise: 'afeeee',
  palevioletred: 'db7093',
  papayawhip: 'ffefd5',
  peachpuff: 'ffdab9',
  peru: 'cd853f',
  pink: 'ffc0cb',
  plum: 'dda0dd',
  powderblue: 'b0e0e6',
  purple: '800080',
  rebeccapurple: '663399',
  red: 'ff0000',
  rosybrown: 'bc8f8f',
  royalblue: '4169e1',
  saddlebrown: '8b4513',
  salmon: 'fa8072',
  sandybrown: 'f4a460',
  seagreen: '2e8b57',
  seashell: 'fff5ee',
  sienna: 'a0522d',
  silver: 'c0c0c0',
  skyblue: '87ceeb',
  slateblue: '6a5acd',
  slategray: '708090',
  slategrey: '708090',
  snow: 'fffafa',
  springgreen: '00ff7f',
  steelblue: '4682b4',
  tan: 'd2b48c',
  teal: '008080',
  thistle: 'd8bfd8',
  tomato: 'ff6347',
  turquoise: '40e0d0',
  violet: 'ee82ee',
  wheat: 'f5deb3',
  white: 'ffffff',
  whitesmoke: 'f5f5f5',
  yellow: 'ffff00',
  yellowgreen: '9acd32',
};

const HEX = /^#([0-9a-f]{3,8})$/i;
const RGB_FUNCTION = /^rgba?\(\s*([^)]*)\)$/i;
const HSL_FUNCTION = /^hsla?\(\s*([^)]*)\)$/i;

export const WHITE = Object.freeze({ r: 255, g: 255, b: 255, a: 1 });
export const BLACK = Object.freeze({ r: 0, g: 0, b: 0, a: 1 });

function fromHex(hex) {
  const digits = hex.length === 3 || hex.length === 4 ? [...hex].map((d) => d + d).join('') : hex;
  if (digits.length !== 6 && digits.length !== 8) return null;
  const channel = (i) => parseInt(digits.slice(i, i + 2), 16);
  return {
    r: channel(0),
    g: channel(2),
    b: channel(4),
    a: digits.length === 8 ? channel(6) / 255 : 1,
  };
}

function parseChannel(token) {
  if (token.endsWith('%')) return Math.round((parseFloat(token) / 100) * 255);
  return Math.round(parseFloat(token));
}

function parseAlpha(token) {
  if (token === undefined) return 1;
  if (token.endsWith('%')) return parseFloat(token) / 100;
  return parseFloat(token);
}

function splitArgs(args) {
  return args
    .replace(/\//g, ' ')
    .split(/[\s,]+/)
    .filter(Boolean);
}

function fromRgbArgs(args) {
  const parts = splitArgs(args);
  if (parts.length < 3) return null;
  const color = {
    r: parseChannel(parts[0]),
    g: parseChannel(parts[1]),
    b: parseChannel(parts[2]),
    a: parseAlpha(parts[3]),
  };
  return Object.values(color).some(Number.isNaN) ? null : color;
}

function hueToChannel(p, q, t) {
  const wrapped = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
  if (wrapped < 1 / 6) return p + (q - p) * 6 * wrapped;
  if (wrapped < 1 / 2) return q;
  if (wrapped < 2 / 3) return p + (q - p) * (2 / 3 - wrapped) * 6;
  return p;
}

function fromHslArgs(args) {
  const parts = splitArgs(args);
  if (parts.length < 3) return null;
  const h = (((parseFloat(parts[0]) % 360) + 360) % 360) / 360;
  const s = parseFloat(parts[1]) / 100;
  const l = parseFloat(parts[2]) / 100;
  if ([h, s, l].some(Number.isNaN)) return null;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t) => Math.round((s === 0 ? l : hueToChannel(p, q, t)) * 255);
  return { r: channel(h + 1 / 3), g: channel(h), b: channel(h - 1 / 3), a: parseAlpha(parts[3]) };
}

export function parseColor(value) {
  if (!value) return null;
  const text = String(value)
    .trim()
    .toLowerCase()
    .replace(/\s*!important$/, '');
  if (text === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (NAMED_COLORS[text]) return fromHex(NAMED_COLORS[text]);
  const hex = HEX.exec(text);
  if (hex) return fromHex(hex[1]);
  if (/^[0-9a-f]{6}$/.test(text)) return fromHex(text);
  const rgb = RGB_FUNCTION.exec(text);
  if (rgb) return fromRgbArgs(rgb[1]);
  const hsl = HSL_FUNCTION.exec(text);
  if (hsl) return fromHslArgs(hsl[1]);
  return null;
}

export function colorFromBackground(value) {
  if (!value) return null;
  const text = String(value).toLowerCase();
  if (/url\(|gradient\(/.test(text)) return undefined;
  const direct = parseColor(text);
  if (direct) return direct;
  const tokens = text.match(/#[0-9a-f]{3,8}\b|(?:rgba?|hsla?)\([^)]*\)|[a-z]+/g) ?? [];
  for (const token of tokens) {
    const color = parseColor(token);
    if (color) return color;
  }
  return null;
}

export function blendOver(top, bottom) {
  if (top.a >= 1) return top;
  const a = top.a;
  return {
    r: Math.round(top.r * a + bottom.r * (1 - a)),
    g: Math.round(top.g * a + bottom.g * (1 - a)),
    b: Math.round(top.b * a + bottom.b * (1 - a)),
    a: 1,
  };
}

export function colorDistance(a, b) {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

export function colorsNearlyEqual(text, background, tolerance = 20) {
  if (!text || !background) return false;
  if (text.a <= 0.05) return true;
  return colorDistance(blendOver(text, background), background) <= tolerance;
}
