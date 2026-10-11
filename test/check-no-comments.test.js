import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findComments, checkRoots, defaultRoots } from '../scripts/check-no-comments.js';

test('finds line and block comments', () => {
  assert.equal(findComments('const a = 1; // note\n/* block */').length, 2);
});

test('ignores comment-like text inside strings and regexes', () => {
  assert.equal(findComments("const a = '// not a comment'; const b = /\\/\\*x/;").length, 0);
});

test('flags a source file containing a comment and passes a clean one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ig-style-'));
  try {
    mkdirSync(join(dir, 'packages', 'demo', 'src'), { recursive: true });
    mkdirSync(join(dir, 'scripts'));
    writeFileSync(join(dir, 'packages', 'demo', 'src', 'clean.js'), 'export const a = 1;\n');
    assert.equal(checkRoots(defaultRoots(dir)).length, 0);
    writeFileSync(join(dir, 'scripts', 'dirty.js'), 'export const b = 2; // hi\n');
    const problems = checkRoots(defaultRoots(dir));
    assert.equal(problems.length, 1);
    assert.equal(problems[0].line, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
