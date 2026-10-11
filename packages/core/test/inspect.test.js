import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectEmail } from '../src/index.js';

const SEVERITIES = new Set(['info', 'low', 'medium', 'high']);

function assertShape(result) {
  assert.ok(['clean', 'suspicious', 'malicious'].includes(result.verdict));
  assert.equal(typeof result.score, 'number');
  assert.equal(typeof result.cleanedText, 'string');
  assert.equal(typeof result.truncated, 'boolean');
  for (const finding of result.findings) {
    assert.deepEqual(Object.keys(finding).sort(), [
      'decoded',
      'hidden',
      'kind',
      'rule',
      'severity',
      'snippet',
      'where',
    ]);
    assert.ok(SEVERITIES.has(finding.severity));
    assert.ok(finding.snippet.length <= 160);
  }
}

function timed(input, options) {
  const started = Date.now();
  const result = inspectEmail(input, options);
  return { result, ms: Date.now() - started };
}

test('result shape and snippet escaping', () => {
  const result = inspectEmail({ text: 'Hi Al\u200bex, re\u200bview this' });
  assertShape(result);
  assert.ok(result.findings.some((f) => f.snippet.includes('<U+200B>')));
  assert.equal(result.cleanedText, 'Hi Alex, review this');
});

test('cleanedText normalizes whitespace and keeps link hosts', () => {
  const result = inspectEmail({
    html: '<p>Hello   there</p>\n\n\n\n<p><a href="https://example.com/a">Docs</a></p>',
  });
  assert.equal(result.cleanedText, 'Hello there\n\nDocs (example.com)');
});

const malformedInputs = [
  ['empty object', {}],
  ['null', null],
  ['undefined', undefined],
  ['plain string', 'just a string'],
  ['number html', { html: 12345 }],
  ['unclosed tags', { html: '<div><p><b>bold <i>italic <table><tr><td>cell' }],
  [
    'garbage markup',
    { html: '<<<>>><!--<!--><![CDATA[x]]><?xml?></div></div>&#xFFFFFFFF;&#0;&bogus;' },
  ],
  ['broken style', { html: '<style>.a{display:none; .b{{{ color: </style><p class="a">x</p>' }],
  [
    'broken selectors',
    { html: '<style>::-webkit-x, a:::b, [unclosed {display:none}</style><p>x</p>' },
  ],
  [
    'invalid utf8 bytes',
    { html: new Uint8Array([0x3c, 0x70, 0x3e, 0xff, 0xfe, 0xc3, 0x28, 0x3c, 0x2f, 0x70, 0x3e]) },
  ],
  ['lone surrogates', { text: 'abc\ud800def\udfff' }],
  ['weird headers', { headers: [{ name: null, value: undefined }, ['X-Note', { a: 1 }]] }],
  [
    'weird attachments',
    {
      attachments: [
        null,
        { filename: 'a.txt' },
        { filename: 'b.bin', content: new Uint8Array(10) },
      ],
    },
  ],
];

for (const [name, input] of malformedInputs) {
  test(`never throws on ${name}`, () => {
    const result = inspectEmail(input);
    assertShape(result);
  });
}

test('deeply nested tags return within budget', () => {
  const html = '<div>'.repeat(100000) + 'hidden? no' + '</div>'.repeat(100000);
  const { result, ms } = timed({ html });
  assertShape(result);
  assert.ok(ms < 3000, `${ms} ms`);
  assert.ok(result.truncated);
  assert.notEqual(result.verdict, 'clean');
});

test('input over 5 MB is capped and at least suspicious', () => {
  const html = '<p>' + 'word '.repeat(1_200_000) + '</p>';
  const { result, ms } = timed({ html });
  assert.ok(result.truncated);
  assert.notEqual(result.verdict, 'clean');
  assert.ok(result.findings.some((f) => f.kind === 'limit-reached'));
  assert.ok(ms < 3000, `${ms} ms`);
});

test('time budget expiry marks result at least suspicious', () => {
  let tick = 0;
  const now = () => (tick += 1000);
  const result = inspectEmail({ html: '<p>hello</p>'.repeat(2000) }, { now });
  assert.ok(result.truncated);
  assert.notEqual(result.verdict, 'clean');
});

test('internal failure returns suspicious with inspection-failed', () => {
  const input = {
    get html() {
      throw new Error('boom');
    },
  };
  const result = inspectEmail(input);
  assert.equal(result.verdict, 'suspicious');
  assert.equal(result.findings[0].kind, 'inspection-failed');
});

const pathological = [
  [
    'many style rules',
    `<style>${Array.from({ length: 5000 }, (_, i) => `.c${i}{color:red}`).join('')}</style><p>x</p>`,
  ],
  ['long attribute', `<p title="${'a'.repeat(2_000_000)}">x</p>`],
  ['comment flood', '<!-- x -->'.repeat(50000)],
  ['entity flood', '&#105;'.repeat(300000)],
  ['base64 flood', 'QUFB'.repeat(500000)],
  ['markdown bracket flood', '[!['.repeat(200000)],
  ['zero width flood', '\u200b\u200c'.repeat(500000)],
  ['nested quotes', '"'.repeat(1_000_000)],
];

for (const [name, payload] of pathological) {
  test(`pathological input: ${name}`, () => {
    const { result, ms } = timed({ html: payload, text: payload.slice(0, 200000) });
    assertShape(result);
    assert.ok(ms < 3000, `${ms} ms`);
  });
}
