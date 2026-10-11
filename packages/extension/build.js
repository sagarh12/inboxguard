import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const dist = join(root, 'dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

await build({
  entryPoints: { content: join(root, 'src/content.js'), options: join(root, 'src/options.js') },
  outdir: dist,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome120'],
  minify: false,
  legalComments: 'none',
  logLevel: 'warning',
});

for (const file of ['manifest.json', 'options.html', 'options.css', 'icons']) {
  cpSync(join(root, file), join(dist, file), { recursive: true });
}

console.log(`built extension into ${dist}`);
