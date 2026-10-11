import { inspectEmail } from '../packages/core/src/index.js';
import { listFixtures, loadFixture, readExpected } from './fixtures.js';

const MIN_DETECTION = 0.95;
const MAX_FALSE_POSITIVE = 0.02;

async function runBench() {
  const expected = readExpected();
  const rows = [];
  for (const path of listFixtures()) {
    const input = await loadFixture(path);
    const started = performance.now();
    const result = inspectEmail(input);
    rows.push({
      path,
      verdict: result.verdict,
      expected: expected[path],
      ms: performance.now() - started,
    });
  }
  return rows;
}

function rate(part, whole) {
  return whole.length === 0 ? 0 : part.length / whole.length;
}

function report(rows) {
  const attacks = rows.filter((r) => r.path.startsWith('attacks/'));
  const benign = rows.filter((r) => r.path.startsWith('benign/'));
  const detection = rate(
    attacks.filter((r) => r.verdict !== 'clean'),
    attacks,
  );
  const falsePositive = rate(
    benign.filter((r) => r.verdict !== 'clean'),
    benign,
  );
  const mismatches = rows.filter((r) => r.expected && r.expected !== r.verdict);
  for (const row of rows) {
    const mark = row.expected === row.verdict ? 'ok  ' : 'FAIL';
    console.log(
      `${mark} ${row.verdict.padEnd(10)} ${row.ms.toFixed(1).padStart(7)} ms  ${row.path}`,
    );
  }
  console.log('');
  console.log(`attacks: ${attacks.length}, detection rate: ${(detection * 100).toFixed(1)}%`);
  console.log(
    `benign: ${benign.length}, false-positive rate: ${(falsePositive * 100).toFixed(1)}%`,
  );
  console.log(`verdict mismatches against expected.json: ${mismatches.length}`);
  const failed = detection < MIN_DETECTION || falsePositive > MAX_FALSE_POSITIVE;
  if (failed) console.error(`bench failed: need detection >= 95% and false positives <= 2%`);
  return failed ? 1 : 0;
}

process.exitCode = report(await runBench());
