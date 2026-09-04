import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rm, cp, stat } from 'node:fs/promises';
import { readFile, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'apps', 'web', 'public', 'cimbar');
const version = process.env.CIMBAR_RUNTIME_VERSION || 'v0.6.8';
const sourceDir = process.env.CIMBAR_SOURCE_DIR
  ? resolve(process.env.CIMBAR_SOURCE_DIR)
  : null;
const archive = join(root, '.cache', `cimbar-${version}.tar.gz`);

await mkdir(target, { recursive: true });
const extracted = sourceDir ?? await downloadAndExtract();
const existingAssets = await readdir(target);
for (const asset of existingAssets) {
  if (/^cimbar_js\.\d.*\.(js|wasm)$/.test(asset)) {
    await rm(join(target, asset), { force: true });
  }
}
const files = await readdir(extracted);
const find = (prefix, suffix) => files.find((file) => file.startsWith(prefix) && file.endsWith(suffix));

const wasm = find('cimbar_js.', '.wasm');
const glue = find('cimbar_js.', '.js');
if (!wasm || !glue) throw new Error(`Cimbar ${version} package has no wasm/glue runtime.`);

const required = [
  [glue, 'cimbar_js.js'],
  [wasm, 'cimbar_js.wasm'],
  [find('send.', '.js'), 'send.js'],
  [find('send-worker.', '.js'), 'send-worker.js'],
  [find('recv.', '.js'), 'recv.js'],
  [find('recv-worker.', '.js'), 'recv-worker.js'],
  [find('zstd.', '.js'), 'zstd.js'],
];
for (const [from, to] of required) {
  if (!from) throw new Error(`Cimbar ${version} package is missing ${to}.`);
  await cp(join(extracted, from), join(target, to));
}
await patchRuntime(join(target, 'send-worker.js'), [
  ["importScripts('send.2026-08-21T2336.js');", "importScripts('send.js');"],
  ["importScripts('cimbar_js.2026-08-21T2336.js');", "importScripts('cimbar_js.js');"],
  ["  preRun: [],\n  onRuntimeInitialized:", "  preRun: [],\n  locateFile: function () { return new URL('./cimbar_js.wasm', self.location.href).toString(); },\n  onRuntimeInitialized:"],
  ["      self.postMessage({ fun: 'startWasm', args: [true] });", "      self.postMessage({ fun: 'startWasm', args: [true] });\n      Send.setMode(68);\n      Send.nextFrame(performance.now());"],
]);
await patchRuntime(join(target, 'recv-worker.js'), [
  ["importScripts('cimbar_js.2026-08-21T2336.js');", "importScripts('cimbar_js.js');"],
  ["  preRun: [],\n  onRuntimeInitialized:", "  preRun: [],\n  locateFile: function () { return new URL('./cimbar_js.wasm', self.location.href).toString(); },\n  onRuntimeInitialized:"],
]);
await patchRuntime(join(target, 'send.js'), [
  ['  var _pause = 0;\n  var _showStats = false;', '  var _pause = 0;\n  var _paused = false;\n  var _showStats = false;'],
  ['      window.requestAnimationFrame(Send.nextFrame);', '      setTimeout(function () { Send.nextFrame(performance.now()); }, _interval);'],
  ['      // pause is a cooldown. We pause to help autofocus, but we don\'t want to do it forever...\n      if (pause === undefined) {\n        pause = !Send.isPaused();\n      }\n      _pause = pause ? 15 : 0;', '      _paused = pause === undefined ? !_paused : Boolean(pause);\n      _pause = 0;'],
  ['      return _pause > 0;', '      return _paused || _pause > 0;'],
]);
await writeFile(join(target, 'VERSION'), `${version}\n${wasm}\n`, 'utf8');
console.log(`Cimbar runtime ${version} synced to ${target}`);

async function downloadAndExtract() {
  const cacheDir = dirname(archive);
  await mkdir(cacheDir, { recursive: true });
  const url = `https://github.com/sz3/libcimbar/releases/download/${version}/cimbar.wasm.tar.gz`;
  try {
    await stat(archive);
    execFileSync('tar', ['-tzf', basename(archive)], { cwd: cacheDir, stdio: 'ignore' });
  } catch {
    await rm(archive, { force: true });
    await download(url, archive);
  }
  const out = join(cacheDir, `cimbar-${version}`);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  execFileSync('tar', ['-xzf', basename(archive), '-C', basename(out)], {
    cwd: cacheDir,
    stdio: 'inherit',
  });
  return out;
}

async function patchRuntime(path, replacements) {
  let source = await readFile(path, 'utf8');
  for (const [before, after] of replacements) {
    if (source.includes(after)) continue;
    if (!source.includes(before)) throw new Error(`Cimbar runtime patch did not match in ${path}: ${before}`);
    source = source.replace(before, after);
  }
  await writeFile(path, source, 'utf8');
}

function download(url, destination) {
  return new Promise((resolvePromise, reject) => {
    const request = https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        download(response.headers.location, destination).then(resolvePromise, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Cimbar download failed: HTTP ${response.statusCode}`));
        return;
      }
      pipeline(response, createWriteStream(destination)).then(resolvePromise, reject);
    });
    request.on('error', reject);
  });
}
