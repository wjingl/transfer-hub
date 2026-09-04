/**
 * QR reader soak benchmark.
 *
 * Usage:
 *   pnpm build
 *   pnpm benchmark:soak
 *
 * This intentionally isolates the QR reader path from camera capture, UI
 * progress, packet parsing, deduplication, and RaptorQ. It repeatedly decodes
 * the same V30-L 2x2 composite image and reports throughput by window.
 *
 * Useful knobs:
 *   RAPTORQR_SOAK_ITERATIONS=10000
 *   RAPTORQR_SOAK_WINDOW=250
 */

import './apps/web/src/tests/setup';

import { performance } from 'node:perf_hooks';

import { describe, expect, test } from 'vitest';

import { createQRTransferProfile } from '@raptorqr/core/protocol/profiles';
import { decodeQRCodesFromCanvas } from '@raptorqr/core/qr/qr_decode';
import { renderQRCodeImageData } from '@raptorqr/core/qr/qr_encoder_browser';

const QR_VERSION = 30;
const ECC_LEVEL = 'L';
const PARALLEL_QR_COUNT = 4;
const SCALE = 2;
const DEFAULT_ITERATIONS = 10_000;
const DEFAULT_WINDOW = 250;
const SOAK_TIMEOUT_MS = 600_000;

interface SoakWindow {
  start: number;
  end: number;
  calls: number;
  decodedQrSymbols: number;
  elapsedMs: number;
  avgDecodeMs: number;
  p95DecodeMs: number;
  callsPerSecond: number;
  qrSymbolsPerSecond: number;
  heapUsedMb: number;
  rssMb: number;
  externalMb: number;
}

function envInteger(name: string, fallback: number, min: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a finite number, got ${raw}`);
  }

  return Math.max(min, Math.round(parsed));
}

function deterministicPayload(byteLength: number, seed: number): Uint8Array {
  const out = new Uint8Array(byteLength);
  let state = seed >>> 0;

  for (let i = 0; i < out.length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out[i] = (state >>> 24) ^ (i & 0xff);
  }

  return out;
}

function blitImageData(
  target: Uint8ClampedArray,
  targetWidth: number,
  source: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  x: number,
  y: number,
): void {
  for (let row = 0; row < sourceHeight; row++) {
    const sourceStart = row * sourceWidth * 4;
    const sourceEnd = sourceStart + sourceWidth * 4;
    const targetStart = ((y + row) * targetWidth + x) * 4;
    target.set(source.subarray(sourceStart, sourceEnd), targetStart);
  }
}

function tileOffset(tileIndex: number, tileSize: number): { x: number; y: number } {
  return {
    x: (tileIndex % 2) * tileSize,
    y: Math.floor(tileIndex / 2) * tileSize,
  };
}

async function buildCompositeImage(): Promise<ImageData> {
  const profile = createQRTransferProfile(QR_VERSION, ECC_LEVEL, 'fast-qr-wasm');
  const tileModules = QR_VERSION * 4 + 17 + 8;
  const tileSize = tileModules * SCALE;
  const width = tileSize * 2;
  const height = tileSize * 2;
  const composite = new Uint8ClampedArray(width * height * 4);
  composite.fill(255);

  for (let tileIndex = 0; tileIndex < PARALLEL_QR_COUNT; tileIndex++) {
    const payload = deterministicPayload(profile.maxPacketSize, 0x5eed_0000 + tileIndex);
    const image = await renderQRCodeImageData(
      payload,
      QR_VERSION,
      ECC_LEVEL,
      SCALE,
      'fast-qr-wasm',
    );
    const { x, y } = tileOffset(tileIndex, tileSize);
    blitImageData(composite, width, image.data, image.width, image.height, x, y);
  }

  return new ImageData(composite, width, height);
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index]!;
}

function mb(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}

function round(value: number, digits = 2): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function summarizeWindow(
  start: number,
  end: number,
  callDurations: number[],
  decodedQrSymbols: number,
): SoakWindow {
  const elapsedMs = callDurations.reduce((sum, value) => sum + value, 0);
  const memory = process.memoryUsage();

  return {
    start,
    end,
    calls: callDurations.length,
    decodedQrSymbols,
    elapsedMs: round(elapsedMs),
    avgDecodeMs: round(elapsedMs / Math.max(1, callDurations.length)),
    p95DecodeMs: round(percentile(callDurations, 0.95)),
    callsPerSecond: round((callDurations.length / elapsedMs) * 1000),
    qrSymbolsPerSecond: round((decodedQrSymbols / elapsedMs) * 1000),
    heapUsedMb: mb(memory.heapUsed),
    rssMb: mb(memory.rss),
    externalMb: mb(memory.external),
  };
}

function printableWindow(window: SoakWindow): Record<string, number | string> {
  return {
    range: `${window.start}-${window.end}`,
    calls: window.calls,
    decodedQR: window.decodedQrSymbols,
    elapsedMs: window.elapsedMs,
    avgDecodeMs: window.avgDecodeMs,
    p95DecodeMs: window.p95DecodeMs,
    callsPerSecond: window.callsPerSecond,
    qrPerSecond: window.qrSymbolsPerSecond,
    heapMB: window.heapUsedMb,
    rssMB: window.rssMb,
    externalMB: window.externalMb,
  };
}

describe('QR reader soak benchmark', () => {
  test('repeatedly decodes the same V30-L 4-symbol frame', async () => {
    const iterations = envInteger('RAPTORQR_SOAK_ITERATIONS', DEFAULT_ITERATIONS, 1);
    const windowSize = envInteger('RAPTORQR_SOAK_WINDOW', DEFAULT_WINDOW, 1);
    const imageData = await buildCompositeImage();

    console.info('[bench:soak] config', {
      profile: `V${QR_VERSION}-${ECC_LEVEL}`,
      scale: SCALE,
      image: `${imageData.width}x${imageData.height}`,
      maxSymbols: PARALLEL_QR_COUNT,
      iterations,
      windowSize,
    });

    const windows: SoakWindow[] = [];
    let currentDurations: number[] = [];
    let currentDecodedSymbols = 0;
    let totalDecodedSymbols = 0;

    for (let i = 0; i < iterations; i++) {
      const startedAt = performance.now();
      const decoded = await decodeQRCodesFromCanvas(imageData, PARALLEL_QR_COUNT);
      const elapsed = performance.now() - startedAt;

      expect(decoded, `decode call ${i + 1}`).toHaveLength(PARALLEL_QR_COUNT);
      decoded.forEach((result) => {
        expect(result.version).toBe(QR_VERSION);
      });

      currentDurations.push(elapsed);
      currentDecodedSymbols += decoded.length;
      totalDecodedSymbols += decoded.length;

      const isWindowEnd = currentDurations.length === windowSize || i === iterations - 1;
      if (!isWindowEnd) continue;

      const window = summarizeWindow(
        i + 2 - currentDurations.length,
        i + 1,
        currentDurations,
        currentDecodedSymbols,
      );
      windows.push(window);
      console.info('[bench:soak] window', printableWindow(window));

      currentDurations = [];
      currentDecodedSymbols = 0;
    }

    const first = windows[0]!;
    const last = windows[windows.length - 1]!;
    const totalElapsedMs = windows.reduce((sum, window) => sum + window.elapsedMs, 0);
    const summary = {
      iterations,
      totalDecodedSymbols,
      totalElapsedMs: round(totalElapsedMs),
      avgCallsPerSecond: round((iterations / totalElapsedMs) * 1000),
      avgQrPerSecond: round((totalDecodedSymbols / totalElapsedMs) * 1000),
      firstQrPerSecond: first.qrSymbolsPerSecond,
      lastQrPerSecond: last.qrSymbolsPerSecond,
      lastVsFirstRatio: round(last.qrSymbolsPerSecond / first.qrSymbolsPerSecond, 3),
      firstAvgDecodeMs: first.avgDecodeMs,
      lastAvgDecodeMs: last.avgDecodeMs,
      rssGrowthMb: round(last.rssMb - first.rssMb, 1),
      externalGrowthMb: round(last.externalMb - first.externalMb, 1),
    };

    console.table(windows.map(printableWindow));
    console.info('[bench:soak] summary', summary);

    expect(totalDecodedSymbols).toBe(iterations * PARALLEL_QR_COUNT);
    expect(summary.avgQrPerSecond).toBeGreaterThan(1);
  }, SOAK_TIMEOUT_MS);
});
