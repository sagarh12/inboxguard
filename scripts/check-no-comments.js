import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as acorn from 'acorn';

const repoRoot = join(fileURLToPath(import.meta.url), '..', '..');

export function findComments(source) {
  const comments = [];
  acorn.parse(source, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    allowHashBang: true,
    locations: true,
    onComment: (block, text, start, end, startLoc) => {
      if (start === 0 && source.startsWith('#!')) return;
      comments.push({ line: startLoc.line, text });
    },
  });
  return comments;
}

function listJsFiles(dir) {
  if (!safeIsDirectory(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name === 'dist') return [];
    const full = join(dir, name);
    if (safeIsDirectory(full)) return listJsFiles(full);
    return /\.(m|c)?js$/.test(name) ? [full] : [];
  });
}

function safeIsDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function defaultRoots(root = repoRoot) {
  const packagesDir = join(root, 'packages');
  const packageSrcDirs = safeIsDirectory(packagesDir)
    ? readdirSync(packagesDir).map((name) => join(packagesDir, name, 'src'))
    : [];
  return [...packageSrcDirs, join(root, 'scripts')];
}

export function checkRoots(roots) {
  const problems = [];
  for (const file of roots.flatMap(listJsFiles)) {
    const source = readFileSync(file, 'utf8');
    try {
      for (const comment of findComments(source)) problems.push({ file, line: comment.line });
    } catch (error) {
      problems.push({ file, line: error.loc?.line ?? 0, parseError: error.message });
    }
  }
  return problems;
}

function runCli() {
  const roots = process.argv.length > 2 ? process.argv.slice(2) : defaultRoots();
  const problems = checkRoots(roots);
  for (const problem of problems) {
    const where = `${relative(process.cwd(), problem.file)}:${problem.line}`;
    console.error(
      problem.parseError ? `${where} parse error: ${problem.parseError}` : `${where} comment found`,
    );
  }
  if (problems.length > 0) process.exit(1);
  console.log('no comments found');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) runCli();
