import { copyFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '..');
const repoRoot = resolve(packageRoot, '..', '..');
const dist = resolve(packageRoot, 'dist');

const assets = [
  {
    source: resolve(repoRoot, 'packages', 'raptorqr-fast-qr-wasm', 'src', 'wasm', 'raptorqr_fast_qr_wasm_bg.wasm'),
    target: resolve(dist, 'raptorqr_fast_qr_wasm_bg.wasm'),
  },
  {
    source: resolve(repoRoot, 'packages', 'raptorqr-raptorq-wasm', 'src', 'wasm', 'raptorqr_raptorq_wasm_bg.wasm'),
    target: resolve(dist, 'raptorqr_raptorq_wasm_bg.wasm'),
  },
];

mkdirSync(dist, { recursive: true });

const targetNames = new Set(assets.map((asset) => basename(asset.target)));
for (const entry of readdirSync(dist)) {
  if (entry.endsWith('_wasm_bg.wasm') && !targetNames.has(entry)) {
    unlinkSync(resolve(dist, entry));
  }
}

for (const asset of assets) {
  copyFileSync(asset.source, asset.target);
  console.log(`copied ${basename(asset.target)}`);
}
