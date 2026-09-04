/**
 * Root release smoke test.
 *
 * Usage:
 *   pnpm install
 *   pnpm build
 *   pnpm test:smoke
 *
 * What this protects:
 * - root-level consumers can resolve the split workspace packages by package name
 * - generated WASM sidecars are present, renamed to raptorqr_*, and loadable
 * - fast_qr actually renders a QR matrix/RGBA image from its WASM module
 * - RaptorQ actually encodes/decodes bytes from its WASM module
 * - core packetization emits wasm-raptorq transport packets, not legacy js-rlnc
 * - the core Node QR facade can read the packaged fast_qr WASM asset
 * - the built CLI and web assets do not carry stale generated sidecars
 */

import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  initSync as initFastQrSync,
  QrRenderer,
} from '@raptorqr/fast-qr-wasm';
import {
  initSync as initRaptorQSync,
  encode_packets,
  RaptorQDecoder,
} from '@raptorqr/raptorq-wasm';
import { DEFAULT_RAPTORQ_REPAIR_PERCENT } from '@raptorqr/core/fec/codec';
import { MAX_PAYLOAD_SIZE, RAPTORQ_SYMBOL_INDEX } from '@raptorqr/core/protocol/constants';
import { packetCodec, parsePacket } from '@raptorqr/core/protocol/packet';
import { RaptorQWasmDecoder } from '@raptorqr/core/fec/raptorq_wasm';
import { packetizeRaptorQ } from '@raptorqr/core/sender/raptorq_packetizer';
import { encodeQRCodeMatrix } from '@raptorqr/core/node';

const textEncoder = new TextEncoder();
const WASM_MAGIC = Buffer.from([0x00, 0x61, 0x73, 0x6d]);
const LEGACY_GENERATED_PREFIX = 'qrs' + 'tream';
const LEGACY_AGGREGATE_PACKAGE = '@raptorqr' + '/wasm';
const LEGACY_AGGREGATE_DIR = 'packages/raptorqr' + '-wasm';

function log(message: string, details?: unknown): void {
  if (details === undefined) {
    console.info(`[smoke] ${message}`);
    return;
  }
  console.info(`[smoke] ${message}`, details);
}

function readJson(path: string): Record<string, unknown> {
  log(`reading manifest: ${path}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

function packageRoot(packageName: string): string {
  const linkPath = join('node_modules', '@raptorqr', packageName);
  expect(existsSync(linkPath)).toBe(true);
  const realPath = realpathSync(linkPath);
  log(`resolved @raptorqr/${packageName}: ${realPath}`);
  return realPath;
}

function packageFile(packageName: string, relativePath: string): string {
  const path = join(packageRoot(packageName), relativePath);
  log(`resolved @raptorqr/${packageName}/${relativePath}: ${path}`);
  return path;
}

function fastQrWasmPath(): string {
  return packageFile('fast-qr-wasm', 'src/wasm/raptorqr_fast_qr_wasm_bg.wasm');
}

function raptorqWasmPath(): string {
  return packageFile('raptorq-wasm', 'src/wasm/raptorqr_raptorq_wasm_bg.wasm');
}

function readBytes(path: string): Buffer {
  const bytes = readFileSync(path);
  log(`reading binary: ${path} (${bytes.byteLength} bytes)`);
  return bytes;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

function expectWasmBinary(path: string, expectedImportName: string): Buffer {
  const bytes = readBytes(path);
  expect(bytes.subarray(0, 4)).toEqual(WASM_MAGIC);
  expect(bytes.includes(Buffer.from(expectedImportName))).toBe(true);
  expect(bytes.includes(Buffer.from(LEGACY_GENERATED_PREFIX))).toBe(false);
  return bytes;
}

function expectNoOldPackageText(path: string): void {
  const text = readFileSync(path, 'utf8');
  expect(text).not.toContain(LEGACY_GENERATED_PREFIX);
  expect(text).not.toContain(LEGACY_AGGREGATE_PACKAGE);
  expect(text).not.toContain(LEGACY_AGGREGATE_DIR.replace('packages/', ''));
}

function expectPackageExport(
  manifest: Record<string, unknown>,
  expectedName: string,
): void {
  const exportsField = manifest.exports as Record<string, { import: string; types: string }>;
  expect(manifest).toMatchObject({
    name: expectedName,
    version: '0.1.1',
    license: 'MIT',
    publishConfig: { access: 'public' },
  });
  expect(exportsField['.']).toMatchObject({
    import: './src/index.js',
    types: './src/index.d.ts',
  });
  expect(exportsField['./wasm/*']).toBe('./src/wasm/*');
}

describe('root release smoke', () => {
  test('split package names resolve to real local package entrypoints', () => {
    // This is the first thing that breaks when root workspace links are stale.
    // The printed paths should point at packages/raptorqr-*-wasm and
    // packages/raptorqr-core, never at the removed aggregate package.
    const resolved = {
      fastQr: packageFile('fast-qr-wasm', 'src/index.js'),
      fastQrWasm: fastQrWasmPath(),
      raptorq: packageFile('raptorq-wasm', 'src/index.js'),
      raptorqWasm: raptorqWasmPath(),
      core: packageFile('core', 'src/index.ts'),
      coreNode: packageFile('core', 'src/node.ts'),
      coreRaptorQ: packageFile('core', 'src/fec/raptorq_wasm.ts'),
    };
    log('resolved package paths', resolved);

    expect(resolved.fastQr).toContain('raptorqr-fast-qr-wasm');
    expect(resolved.fastQr).toMatch(/src[\\/]index\.js$/);
    expect(resolved.fastQrWasm).toContain('raptorqr_fast_qr_wasm_bg.wasm');
    expect(resolved.raptorq).toContain('raptorqr-raptorq-wasm');
    expect(resolved.raptorq).toMatch(/src[\\/]index\.js$/);
    expect(resolved.raptorqWasm).toContain('raptorqr_raptorq_wasm_bg.wasm');
    expect(resolved.core).toContain('raptorqr-core');
    expect(resolved.coreNode).toContain('raptorqr-core');
    expect(resolved.coreRaptorQ).toContain('raptorqr-core');
    Object.values(resolved).forEach((path) => expect(existsSync(path)).toBe(true));

    expect(existsSync(join('node_modules', '@raptorqr', 'wasm'))).toBe(false);
    expect(existsSync(LEGACY_AGGREGATE_DIR)).toBe(false);
  });

  test('publish manifests expose JS runtime entrypoints and renamed WASM subpaths', () => {
    const fastQrPkg = readJson('packages/raptorqr-fast-qr-wasm/package.json');
    const raptorqPkg = readJson('packages/raptorqr-raptorq-wasm/package.json');
    const corePkg = readJson('packages/raptorqr-core/package.json');
    const cliPkg = readJson('packages/raptorqr-cli/package.json');

    expectPackageExport(fastQrPkg, '@raptorqr/fast-qr-wasm');
    expectPackageExport(raptorqPkg, '@raptorqr/raptorq-wasm');
    expect(corePkg).toMatchObject({
      name: '@raptorqr/core',
      version: '0.1.1',
      license: 'MIT',
      publishConfig: { access: 'public' },
    });
    expect(cliPkg).toMatchObject({
      name: '@raptorqr/cli',
      version: '0.1.1',
      license: 'MIT',
      publishConfig: { access: 'public' },
      bin: { raptorqr: 'dist/raptorqr.js' },
    });

    expectNoOldPackageText('packages/raptorqr-fast-qr-wasm/package.json');
    expectNoOldPackageText('packages/raptorqr-raptorq-wasm/package.json');
    expectNoOldPackageText('packages/raptorqr-core/package.json');
    expectNoOldPackageText('packages/raptorqr-cli/package.json');
  });

  test('generated WASM glue references raptorqr names, not stale generated names', () => {
    // wasm-bindgen stores the import module name in both JS glue and the .wasm
    // binary. If only filenames are renamed, this test catches the mismatch.
    const fastQrJs = packageFile('fast-qr-wasm', 'src/wasm/raptorqr_fast_qr_wasm.js');
    const fastQrWasm = fastQrWasmPath();
    const raptorqJs = packageFile('raptorq-wasm', 'src/wasm/raptorqr_raptorq_wasm.js');
    const raptorqWasm = raptorqWasmPath();

    log('checking wasm-bindgen glue paths', { fastQrJs, fastQrWasm, raptorqJs, raptorqWasm });

    const fastQrGlue = readFileSync(fastQrJs, 'utf8');
    const raptorqGlue = readFileSync(raptorqJs, 'utf8');
    expect(fastQrGlue).toContain('raptorqr_fast_qr_wasm_bg.wasm');
    expect(fastQrGlue).toContain('./raptorqr_fast_qr_wasm_bg.js');
    expect(raptorqGlue).toContain('raptorqr_raptorq_wasm_bg.wasm');
    expect(raptorqGlue).toContain('./raptorqr_raptorq_wasm_bg.js');
    expect(fastQrGlue).not.toContain(LEGACY_GENERATED_PREFIX);
    expect(raptorqGlue).not.toContain(LEGACY_GENERATED_PREFIX);

    expectWasmBinary(fastQrWasm, 'raptorqr_fast_qr_wasm_bg.js');
    expectWasmBinary(raptorqWasm, 'raptorqr_raptorq_wasm_bg.js');
  });

  test('fast QR WASM renders matrix and RGBA output', () => {
    const wasmPath = fastQrWasmPath();
    const wasmBytes = readBytes(wasmPath);
    const wasm = initFastQrSync({ module: wasmBytes });
    const renderer = new QrRenderer();
    const data = textEncoder.encode('raptorqr fast qr smoke');

    const sideModules = renderer.render_matrix(data, 10, 1);
    const matrix = new Uint8Array(
      wasm.memory.buffer,
      renderer.matrix_ptr(),
      sideModules * sideModules,
    );

    log('fast QR matrix rendered', {
      sideModules,
      matrixBytes: matrix.byteLength,
      matrixPtr: renderer.matrix_ptr(),
    });

    expect(sideModules).toBeGreaterThan(0);
    expect(matrix.some((value) => value === 1)).toBe(true);
    expect(matrix.some((value) => value === 0)).toBe(true);

    const sidePx = renderer.render_rgba(data, 10, 1, 3);
    log('fast QR RGBA rendered', {
      sidePx,
      rgbaPtr: renderer.rgba_ptr(),
      rgbaCapacity: renderer.rgba_len(),
    });

    expect(sidePx).toBeGreaterThan(0);
    expect(renderer.rgba_ptr()).toBeGreaterThan(0);
    expect(renderer.rgba_len()).toBeGreaterThanOrEqual(sidePx * sidePx * 4);
  });

  test('RaptorQ WASM encodes unique packets and decodes them', () => {
    const wasmPath = raptorqWasmPath();
    const wasmBytes = readBytes(wasmPath);
    initRaptorQSync({ module: wasmBytes });

    const original = textEncoder.encode('raptorqr raptorq wasm smoke'.repeat(80));
    const transportPayloadSize = 256;
    const packets = Array.from(
      encode_packets(original, transportPayloadSize, 25),
      (packet) => new Uint8Array(packet),
    );
    const uniquePayloadIds = new Set(
      packets.map((packet) => Buffer.from(packet.slice(0, 4)).toString('hex')),
    );

    log('RaptorQ raw packets encoded', {
      inputBytes: original.length,
      packetCount: packets.length,
      uniquePayloadIds: uniquePayloadIds.size,
      maxPacketBytes: Math.max(...packets.map((packet) => packet.length)),
      transportPayloadSize,
    });

    expect(packets.length).toBeGreaterThan(0);
    expect(packets.every((packet) => packet.length <= transportPayloadSize)).toBe(true);
    expect(uniquePayloadIds.size).toBe(packets.length);

    const decoder = new RaptorQDecoder(original.length, transportPayloadSize);
    let decoded: Uint8Array | null = null;
    for (const packet of packets) {
      decoded = decoder.push(packet);
      if (decoded) break;
    }

    expect(decoded).not.toBeNull();
    expect(bytesEqual(original, decoded!.slice(0, original.length))).toBe(true);
  });

  test('core packetizer emits real RaptorQ transport packets and decodes back', async () => {
    // This test is the important "not secretly js-rlnc" guard:
    // 1. every transport packet must carry the RaptorQ sentinel symbol index
    // 2. packetCodec must report wasm-raptorq
    // 3. the payloads must decode through RaptorQWasmDecoder back to original bytes
    const original = textEncoder.encode('raptorqr core packetizer smoke'.repeat(32));
    initRaptorQSync({ module: readBytes(raptorqWasmPath()) });
    const result = await packetizeRaptorQ(
      original,
      true,
      false,
      undefined,
      undefined,
      {
        maxTransportPayloadSize: MAX_PAYLOAD_SIZE,
        repairPercent: DEFAULT_RAPTORQ_REPAIR_PERCENT,
      },
    );
    const parsedPackets = result.packets.map((packet) => parsePacket(packet));

    log('core packetizer emitted packets', {
      packets: result.packets.length,
      sourceGenerations: result.sourceGenerations,
      totalGenerations: result.totalGenerations,
      dataLength: result.dataLength,
      symbolSize: result.symbolSize,
      firstSymbolIndex: parsedPackets[0]?.header.symbolIndex,
      firstCodec: parsedPackets[0] ? packetCodec(parsedPackets[0].header) : null,
    });

    expect(result.packets.length).toBeGreaterThan(0);
    expect(result.isCompressed).toBe(false);
    expect(result.dataLength).toBe(original.length);
    expect(result.symbolSize).toBe(MAX_PAYLOAD_SIZE);
    expect(parsedPackets.every((packet) => packetCodec(packet.header) === 'wasm-raptorq')).toBe(true);
    expect(parsedPackets.every((packet) => packet.header.symbolIndex === RAPTORQ_SYMBOL_INDEX)).toBe(true);
    expect(parsedPackets.every((packet) => packet.payload.length <= MAX_PAYLOAD_SIZE)).toBe(true);

    const decoder = await RaptorQWasmDecoder.create(
      parsedPackets[0]!.header.dataLength,
      parsedPackets[0]!.payload.length,
    );

    let decoded: Uint8Array | null = null;
    for (const packet of parsedPackets) {
      decoded = decoder.push(packet.payload);
      if (decoded) break;
    }

    expect(decoded).not.toBeNull();
    expect(bytesEqual(original, decoded!.slice(0, original.length))).toBe(true);
  });

  test('core Node QR facade renders a RaptorQ packet through fast QR WASM', async () => {
    // The web app uses Vite URL loading, but the CLI/Node path reads the
    // package/exported sidecar from disk. This catches broken Node asset
    // resolution that may not show up in browser-only testing.
    initRaptorQSync({ module: readBytes(raptorqWasmPath()) });
    const result = await packetizeRaptorQ(
      textEncoder.encode('node qr facade smoke'),
      true,
      false,
      undefined,
      undefined,
      {
        maxTransportPayloadSize: MAX_PAYLOAD_SIZE,
        repairPercent: DEFAULT_RAPTORQ_REPAIR_PERCENT,
      },
    );
    const matrix = await encodeQRCodeMatrix(result.packets[0]!, 10, 'M');

    log('core Node QR facade rendered matrix', {
      packetBytes: result.packets[0]!.length,
      rows: matrix.length,
      cols: matrix[0]?.length ?? 0,
    });

    expect(matrix.length).toBeGreaterThan(0);
    expect(matrix.every((row) => row.length === matrix.length)).toBe(true);
    expect(matrix.some((row) => row.some(Boolean))).toBe(true);
  });

  test('CLI bundle starts and ships only renamed WASM sidecars', () => {
    const cliFiles = readdirSync('packages/raptorqr-cli/dist');
    log('CLI dist files', cliFiles);

    expect(cliFiles).toContain('raptorqr.js');
    expect(cliFiles).toContain('raptorqr_fast_qr_wasm_bg.wasm');
    expect(cliFiles).toContain('raptorqr_raptorq_wasm_bg.wasm');
    expect(cliFiles.some((file) => file.includes(LEGACY_GENERATED_PREFIX))).toBe(false);
    expectNoOldPackageText('packages/raptorqr-cli/dist/raptorqr.js');

    const result = spawnSync('node', ['packages/raptorqr-cli/dist/raptorqr.js', '--help'], {
      encoding: 'utf8',
    });
    log('CLI --help output', result.stdout.trim().split(/\r?\n/).slice(0, 5));

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('raptorqr [file]');
    expect(result.stdout).toContain('raptorqr --serve');
  });

  test('web build assets include renamed WASM files and no stale generated files', () => {
    const assetDir = 'apps/web/dist/assets';
    expect(existsSync(assetDir)).toBe(true);

    const assets = readdirSync(assetDir);
    log('web wasm assets', assets.filter((file) => file.endsWith('.wasm')));

    expect(assets.some((file) => /^raptorqr_fast_qr_wasm_bg-.+\.wasm$/.test(file))).toBe(true);
    expect(assets.some((file) => /^raptorqr_raptorq_wasm_bg-.+\.wasm$/.test(file))).toBe(true);
    expect(assets.some((file) => file.includes(LEGACY_GENERATED_PREFIX))).toBe(false);
  });
});
