import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectEmail } from '../src/index.js';
import { listFixtures, loadFixture, readExpected } from '../../../scripts/fixtures.js';

const expected = readExpected();

test('every fixture is listed in expected.json', () => {
  assert.deepEqual(listFixtures().sort(), Object.keys(expected).sort());
});

for (const path of listFixtures()) {
  test(`fixture ${path} gives ${expected[path]}`, async () => {
    const result = inspectEmail(await loadFixture(path));
    assert.equal(result.verdict, expected[path], JSON.stringify(result.findings, null, 2));
  });
}

test('malicious fixtures never leak hidden text into cleanedText', async () => {
  const result = inspectEmail(await loadFixture('attacks/css-display-none.eml'));
  assert.ok(!/note to the ai/i.test(result.cleanedText));
  assert.match(result.cleanedText, /invoice INV-20431/);
});

test('preheader is reported as info and kept out of cleanedText', async () => {
  const result = inspectEmail(await loadFixture('benign/marketing-preheader.eml'));
  assert.ok(result.findings.some((f) => f.kind === 'preheader' && f.severity === 'info'));
  assert.ok(!result.cleanedText.includes('20% off this week only'));
});

test('security newsletter quoting injections stays clean with info findings', async () => {
  const result = inspectEmail(await loadFixture('benign/security-newsletter.eml'));
  assert.equal(result.verdict, 'clean');
  assert.ok(result.findings.some((f) => f.kind === 'quoted-instruction'));
});
