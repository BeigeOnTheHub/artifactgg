// scripts/copy-assets.mjs
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = resolve(__dirname, '../assets');
const dst = resolve(__dirname, '../public/assets');

if (!existsSync(src)) {
  console.error(`[copy-assets] source not found: ${src}`);
  process.exit(1);
}

// Sanity guard: rmSync with recursive + force will happily nuke whatever you
// point it at. If the destination ever drifts off the expected
// public/assets shape (typo in a refactor, env-driven path, etc.) bail
// loud instead of removing the wrong tree.
const expectedSuffix = `${sep}public${sep}assets`;
if (!dst.endsWith(expectedSuffix)) {
  console.error(`[copy-assets] refusing to delete unexpected dst: ${dst}`);
  process.exit(1);
}

rmSync(dst, { recursive: true, force: true });
mkdirSync(dirname(dst), { recursive: true });
cpSync(src, dst, { recursive: true });

console.log(`[copy-assets] copied ${src} -> ${dst}`);
