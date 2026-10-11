import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeHtml, parseLengthPx } from '../src/hidden.js';
import { parseColor, colorsNearlyEqual } from '../src/colors.js';
import { createBudget, resolveLimits } from '../src/limits.js';

const SECRET = 'secret payload words here';
const analyze = (html) => analyzeHtml(html, createBudget(resolveLimits()));

const hiddenCases = [
  ['display none', `<div style="display:none">${SECRET}</div>`, 'display:none'],
  [
    'display none important uppercase',
    `<div style="DISPLAY: NONE !important">${SECRET}</div>`,
    'display:none',
  ],
  ['visibility hidden', `<span style="visibility:hidden">${SECRET}</span>`, 'visibility:hidden'],
  ['hidden attribute', `<p hidden>${SECRET}</p>`, 'hidden attribute'],
  ['mso-hide', `<div style="mso-hide:all">${SECRET}</div>`, 'mso-hide:all'],
  ['font-size zero', `<span style="font-size:0">${SECRET}</span>`, 'font-size'],
  ['font-size 1px', `<span style="font-size:1px">${SECRET}</span>`, 'font-size'],
  ['font-size 0.5pt', `<span style="font-size:0.5pt">${SECRET}</span>`, 'font-size'],
  ['font-size tiny em', `<span style="font-size:0.01em">${SECRET}</span>`, 'font-size'],
  ['font-size tiny rem', `<span style="font-size:0.05rem">${SECRET}</span>`, 'font-size'],
  ['font-size tiny percent', `<span style="font-size:3%">${SECRET}</span>`, 'font-size'],
  ['font shorthand', `<span style="font:0/0 a">${SECRET}</span>`, 'font-size'],
  [
    'inherited tiny em',
    `<div style="font-size:2px"><span style="font-size:0.4em">${SECRET}</span></div>`,
    'font-size',
  ],
  ['opacity', `<div style="opacity:0.01">${SECRET}</div>`, 'opacity'],
  [
    'nested opacity product',
    `<div style="opacity:0.2"><p style="opacity:0.2">${SECRET}</p></div>`,
    'opacity',
  ],
  ['line-height zero', `<div style="line-height:0">${SECRET}</div>`, 'line-height:0'],
  ['scale zero', `<div style="transform:scale(0)">${SECRET}</div>`, 'transform:scale(0)'],
  ['max-height zero', `<div style="max-height:0px">${SECRET}</div>`, 'max-height:0'],
  [
    'zero height overflow hidden',
    `<div style="height:0;overflow:hidden">${SECRET}</div>`,
    'zero size with overflow hidden',
  ],
  ['clip rect', `<div style="position:absolute;clip:rect(0 0 0 0)">${SECRET}</div>`, 'clip'],
  ['clip-path', `<div style="clip-path:inset(50%)">${SECRET}</div>`, 'clip-path'],
  ['text-indent', `<div style="text-indent:-9999px">${SECRET}</div>`, 'text-indent'],
  [
    'offscreen',
    `<div style="position:absolute;left:-5000px">${SECRET}</div>`,
    'positioned off screen',
  ],
  [
    'white on white',
    `<div style="background:#fff"><span style="color:#ffffff">${SECRET}</span></div>`,
    'text color matches background',
  ],
  [
    'near white on default',
    `<span style="color:rgb(254,254,254)">${SECRET}</span>`,
    'text color matches background',
  ],
  [
    'named color match',
    `<table bgcolor="navy"><tr><td><font color="#000080">${SECRET}</font></td></tr></table>`,
    'text color matches background',
  ],
  [
    'rgba transparent text',
    `<span style="color:rgba(0,0,0,0)">${SECRET}</span>`,
    'text color matches background',
  ],
  [
    'dark on dark',
    `<div style="background-color:#111"><p style="color:#121212">${SECRET}</p></div>`,
    'text color matches background',
  ],
  [
    'class rule',
    `<style>.pre{display:none}</style><div class="pre">${SECRET}</div>`,
    'display:none',
  ],
  ['id rule', `<style>#x{font-size:0}</style><div id="x">${SECRET}</div>`, 'font-size'],
  ['tag rule', `<style>span{visibility:hidden}</style><span>${SECRET}</span>`, 'visibility:hidden'],
  [
    'media rule',
    `<style>@media screen{.m{display:none}}</style><div class="m">${SECRET}</div>`,
    'display:none',
  ],
  [
    'descendant rule',
    `<style>div .c{color:#fff}</style><div><span class="c">${SECRET}</span></div>`,
    'text color matches background',
  ],
];

for (const [name, html, reason] of hiddenCases) {
  test(`hidden: ${name}`, () => {
    const result = analyze(`<html><body><p>Visible greeting</p>${html}</body></html>`);
    const segment = result.hiddenSegments.find((s) => s.text.includes(SECRET));
    assert.ok(segment, JSON.stringify(result.hiddenSegments));
    assert.equal(segment.reason, reason);
    assert.ok(!result.visibleText.includes(SECRET));
  });
}

const visibleCases = [
  ['plain', `<p>${SECRET}</p>`],
  ['normal font', `<span style="font-size:14px">${SECRET}</span>`],
  ['grey footer text', `<p style="color:#999999">${SECRET}</p>`],
  ['white on dark', `<div style="background:#000"><p style="color:#fff">${SECRET}</p></div>`],
  ['opacity half', `<div style="opacity:0.5">${SECRET}</div>`],
  [
    'visibility override',
    `<div style="visibility:hidden"><span style="visibility:visible">${SECRET}</span></div>`,
  ],
  [
    'important beats later',
    `<style>.a{display:block !important}</style><div class="a" style="display:none">x</div><p>${SECRET}</p>`,
  ],
  [
    'hover rule ignored',
    `<style>a:hover{display:none}</style><a href="https://example.com">${SECRET}</a>`,
  ],
  [
    'background image unknown',
    `<div style="background:url(bg.png)"><p style="color:#fff">${SECRET}</p></div>`,
  ],
  ['font weight number', `<span style="font:700 14px Arial">${SECRET}</span>`],
];

for (const [name, html] of visibleCases) {
  test(`visible: ${name}`, () => {
    const result = analyze(`<html><body>${html}</body></html>`);
    assert.ok(result.visibleText.includes(SECRET), JSON.stringify(result));
  });
}

test('carriers: comments, attributes and hidden elements', () => {
  const html = `<html><head><title>T title</title><meta name="description" content="meta words"></head><body>
    <!-- plain comment words -->
    <!--[if mso]><table><tr><td>mso only</td></tr></table><![endif]-->
    <img src="https://example.com/a.png" alt="alt words" title="title words">
    <img src="https://example.com/p.gif" width="1" height="1" alt="pixel alt">
    <div data-note="data words" aria-label="aria words">x</div>
    <input type="hidden" value="input words">
    <noscript>noscript words</noscript><template>template words</template><textarea>textarea words</textarea>
    <svg><text>svg text words</text><desc>svg desc words</desc></svg>
    <script>var a = "script words";</script>
    <style>/* css comment words */ .x:before{content:"style content words"}</style>
  </body></html>`;
  const result = analyze(html);
  const texts = result.carriers.map((c) => c.text);
  for (const expected of [
    'plain comment words',
    'alt words',
    'title words',
    'data words',
    'aria words',
    'input words',
    'noscript words',
    'template words',
    'textarea words',
    'svg text words',
    'svg desc words',
    'script words',
    'css comment words',
    'style content words',
    'meta words',
    'T title',
  ]) {
    assert.ok(
      texts.some((t) => t.includes(expected)),
      `missing ${expected}`,
    );
  }
  assert.ok(!texts.some((t) => t.includes('pixel alt')));
  const conditional = result.carriers.find((c) => c.text.includes('mso only'));
  assert.equal(conditional.conditional, true);
  for (const word of ['noscript', 'template', 'textarea', 'svg', 'script words', 'css comment']) {
    assert.ok(!result.visibleText.includes(word), word);
  }
});

test('links show host, images are not described', () => {
  const result = analyze(
    '<p><a href="https://shop.example.com/x?y=1">Shop now</a> <img src="https://example.com/i.png" alt="banner"></p>',
  );
  assert.match(result.visibleText, /Shop now \(shop\.example\.com\)/);
  assert.ok(!result.visibleText.includes('banner'));
  assert.ok(!result.visibleText.includes('i.png'));
});

test('split inline tags join without spaces', () => {
  const result = analyze('<p>ig<span>no</span>re</p>');
  assert.match(result.visibleText, /ignore/);
});

test('depth limit flattens deep trees without throwing', () => {
  const budget = createBudget(resolveLimits({ maxDomDepth: 50 }));
  const html = '<div>'.repeat(5000) + 'deep text' + '</div>'.repeat(5000);
  const result = analyzeHtml(html, budget);
  assert.match(result.visibleText, /deep text/);
  assert.ok(budget.hits().includes('dom-depth'));
});

test('length and color parsing', () => {
  assert.equal(parseLengthPx('12pt'), 16);
  assert.equal(parseLengthPx('2em', 10), 20);
  assert.equal(parseLengthPx('bogus'), null);
  assert.deepEqual(parseColor('#abc'), { r: 170, g: 187, b: 204, a: 1 });
  assert.deepEqual(parseColor('rgb(10 20 30 / 50%)'), { r: 10, g: 20, b: 30, a: 0.5 });
  assert.deepEqual(parseColor('hsl(0, 0%, 100%)'), { r: 255, g: 255, b: 255, a: 1 });
  assert.equal(colorsNearlyEqual(parseColor('white'), parseColor('#fdfdfd')), true);
  assert.equal(colorsNearlyEqual(parseColor('#999'), parseColor('#fff')), false);
});
