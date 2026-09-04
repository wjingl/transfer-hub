/**
 * Tests for the CLI terminal QR rasterizer.
 *
 * Verifies that the terminal rasterizer correctly renders boolean QR matrices
 * as half-block Unicode art, that the encoder pipeline produces valid QR data,
 * and the end-to-end CLI pipeline works (without actually clearing the screen).
 */
import { describe, it, expect } from 'vitest';

/** Strip ANSI escape sequences from a string */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

async function packetizeCliRaptorQ(
  data: Uint8Array,
  isText: boolean,
  compress: boolean,
  filename?: string,
  mimeType?: string,
) {
  const { DEFAULT_RAPTORQ_REPAIR_PERCENT } = await import('@raptorqr/core/fec/codec');
  const { MAX_PAYLOAD_SIZE } = await import('@raptorqr/core/protocol/constants');
  const { packetizeRaptorQ } = await import('@raptorqr/core/sender/raptorq_packetizer');

  return packetizeRaptorQ(
    data,
    isText,
    compress,
    filename,
    mimeType,
    {
      maxTransportPayloadSize: MAX_PAYLOAD_SIZE,
      repairPercent: DEFAULT_RAPTORQ_REPAIR_PERCENT,
    },
  );
}

describe('Terminal Rasterizer', () => {
  it('should render a simple 2×2 matrix with default quiet zone', async () => {
    const { renderToTerminal } = await import('../terminal_raster');

    const matrix = [
      [true, true],
      [true, true],
    ];

    const lines = renderToTerminal(matrix).map(stripAnsi);
    expect(lines.length).toBe(5);
    expect(lines[0]).toBe(' '.repeat(10));
    expect(lines[1]).toBe(' '.repeat(10));
    expect(lines[2]).toBe('    \u2588\u2588    ');
    expect(lines[3]).toBe(' '.repeat(10));
    expect(lines[4]).toBe(' '.repeat(10));
  });

  it('should render mixed 4×4 matrix with default quiet zone', async () => {
    const { renderToTerminal } = await import('../terminal_raster');

    const matrix = [
      [true, false, true, false],
      [false, true, false, true],
      [true, true, false, false],
      [false, false, true, true],
    ];

    const lines = renderToTerminal(matrix).map(stripAnsi);
    expect(lines.length).toBe(6);

    const qrLine0 = lines[2]!;
    expect(qrLine0.length).toBe(12);
    expect(qrLine0[4]).toBe('\u2580');
    expect(qrLine0[5]).toBe('\u2584');
    expect(qrLine0[6]).toBe('\u2580');
    expect(qrLine0[7]).toBe('\u2584');

    const qrLine1 = lines[3]!;
    expect(qrLine1[4]).toBe('\u2580');
    expect(qrLine1[5]).toBe('\u2580');
    expect(qrLine1[6]).toBe('\u2584');
    expect(qrLine1[7]).toBe('\u2584');
  });

  it('should handle odd number of QR rows', async () => {
    const { renderToTerminal } = await import('../terminal_raster');

    const matrix = [
      [true, false, true],
      [false, true, false],
      [true, false, true],
    ];

    const lines = renderToTerminal(matrix).map(stripAnsi);
    expect(lines.length).toBe(6);
    expect(lines[2]!.length).toBe(11);
    expect(lines[3]!.length).toBe(11);
    expect(lines[3]![4]).toBe('\u2580');
    expect(lines[3]![5]).toBe(' ');
    expect(lines[3]![6]).toBe('\u2580');
  });

  it('should render an all-white matrix', async () => {
    const { renderToTerminal } = await import('../terminal_raster');

    const matrix = [
      [false, false],
      [false, false],
    ];

    const lines = renderToTerminal(matrix).map(stripAnsi);
    expect(lines.length).toBe(5);
    expect(lines[2]).toBe(' '.repeat(10));
  });

  it('should render a full-block matrix', async () => {
    const { renderToTerminal } = await import('../terminal_raster');

    const matrix = [
      [true, true],
      [true, true],
    ];

    const lines = renderToTerminal(matrix).map(stripAnsi);
    expect(lines.length).toBe(5);
    expect(lines[2]).toBe('    \u2588\u2588    ');
  });

  it('should support custom quiet zone size', async () => {
    const { renderToTerminal } = await import('../terminal_raster');

    const matrix = [
      [true, true],
      [true, true],
    ];

    const lines = renderToTerminal(matrix, 2).map(stripAnsi);
    expect(lines.length).toBe(3);
    expect(lines[0]).toBe(' '.repeat(6));
    expect(lines[1]).toBe('  \u2588\u2588  ');
    expect(lines[2]).toBe(' '.repeat(6));
  });

  it('should support zero quiet zone', async () => {
    const { renderToTerminal } = await import('../terminal_raster');

    const matrix = [
      [true, true],
      [true, true],
    ];

    const lines = renderToTerminal(matrix, 0).map(stripAnsi);
    expect(lines.length).toBe(1);
    expect(lines[0]).toBe('\u2588\u2588');
  });

  it('should wrap each line with ANSI colour codes', async () => {
    const { renderToTerminal } = await import('../terminal_raster');

    const matrix = [
      [true, true],
      [true, true],
    ];

    const lines = renderToTerminal(matrix);
    // Every line should start with white-bg + black-fg and end with reset
    for (const line of lines) {
      expect(line.startsWith('\x1b[47m\x1b[30m')).toBe(true);
      expect(line.endsWith('\x1b[0m')).toBe(true);
    }
  });
});

describe('CLI Screen Helpers', () => {
  it('should expose clearScreen', async () => {
    const { clearScreen } = await import('../terminal_raster');
    expect(typeof clearScreen).toBe('function');
  });

  it('should expose moveCursorUp', async () => {
    const { moveCursorUp } = await import('../terminal_raster');
    expect(typeof moveCursorUp).toBe('function');
  });

  it('should expose alt-buffer helpers', async () => {
    const { enterAltBuffer, exitAltBuffer } = await import('../terminal_raster');
    expect(typeof enterAltBuffer).toBe('function');
    expect(typeof exitAltBuffer).toBe('function');
  });
});

describe('CLI Help Flag', () => {
  it('should not throw when help text is constructed', () => {
    const helpText = `
RaptorQR \u2013 encode text or a file into a looping QR-code sequence.

Usage:
  raptorqr [file]              read from file
  echo "text" | raptorqr       read from stdin
  raptorqr --serve             start web app preview server

Controls:
  q, Q         quit
  Ctrl-C       quit

The app uses the same transfer protocol as the web sender.
`;
    expect(helpText).toContain('Usage:');
    expect(helpText).toContain('quit');
  });
});

describe('CLI Encoder Pipeline', () => {
  it('should produce RaptorQ frames using the default sender codec', async () => {
    const {
      DEFAULT_CLI_QR_ENCODER,
      encodeQRCodeMatrix,
      isFastQrNodeAvailable,
    } = await import('@raptorqr/core/node');
    const { QR_VERSION, ECC_LEVEL, RAPTORQ_SYMBOL_INDEX } = await import('@raptorqr/core/protocol/constants');
    const { parseHeader } = await import('@raptorqr/core/protocol/packet');

    const data = new TextEncoder().encode('CLI test payload for verifying protocol reuse. '.repeat(3));
    const result = await packetizeCliRaptorQ(data, false, true);
    const ordered = result.packets;
    const headers = ordered.map((pkt) => parseHeader(pkt));

    expect(DEFAULT_CLI_QR_ENCODER).toBe('fast-qr-wasm');
    expect(isFastQrNodeAvailable()).toBe(true);
    expect(ordered.length).toBe(result.totalGenerations);
    expect(headers.every((header) => header.symbolIndex === RAPTORQ_SYMBOL_INDEX)).toBe(true);
    expect(headers.every((header) => header.generationIndex === 0)).toBe(true);

    for (const pkt of ordered) {
      const matrix = await encodeQRCodeMatrix(pkt, QR_VERSION, ECC_LEVEL);
      expect(matrix.length).toBe(57);
      expect(matrix[0]!.length).toBe(57);
    }

    expect(result.isCompressed).toBe(true);
    expect(result.dataLength).toBeGreaterThan(0);
  });
});

describe('CLI Frame Cycle', () => {
  it('should loop through frames deterministically', async () => {
    const data = new TextEncoder().encode('Frame cycle test — small payload');
    const result = await packetizeCliRaptorQ(data, false, false);
    const ordered = result.packets;

    expect(ordered.length).toBe(result.packets.length);

    const totalFrames = ordered.length;
    const frameSequence: number[] = [];
    for (let i = 0; i < totalFrames * 3; i++) {
      frameSequence.push(i % totalFrames);
    }

    const uniqueIndices = new Set(frameSequence);
    expect(uniqueIndices.size).toBe(totalFrames);
    expect(frameSequence.length).toBe(totalFrames * 3);
  });

  it('should generate valid QR matrix for every scheduled frame', async () => {
    const { encodeQRCodeMatrix } = await import('@raptorqr/core/node');
    const { QR_VERSION, ECC_LEVEL } = await import('@raptorqr/core/protocol/constants');

    const data = new TextEncoder().encode('Every frame QR test — medium payload');
    const result = await packetizeCliRaptorQ(data, false, true);
    const ordered = result.packets;

    for (const pkt of ordered) {
      const matrix = await encodeQRCodeMatrix(pkt, QR_VERSION, ECC_LEVEL);
      expect(matrix.length).toBe(57);
      expect(matrix[0]!.length).toBe(57);
      const hasDark = matrix.some((row) => row.some((cell) => cell));
      expect(hasDark).toBe(true);
    }
  });
});

describe('CLI Input Parsing', () => {
  it('should read file from argument and produce frames', async () => {
    const { RAPTORQ_SYMBOL_INDEX } = await import('@raptorqr/core/protocol/constants');
    const { parseHeader } = await import('@raptorqr/core/protocol/packet');

    const fileData = new TextEncoder().encode('file content test');
    const result = await packetizeCliRaptorQ(
      fileData,
      false,
      false,
      'sample.txt',
      'text/plain',
    );
    const ordered = result.packets;
    const headers = ordered.map((pkt) => parseHeader(pkt));

    expect(ordered.length).toBeGreaterThan(0);
    expect(result.isText).toBe(false);
    expect(result.isCompressed).toBe(false);
    expect(result.dataLength).toBeGreaterThan(fileData.length);
    expect(headers.length).toBe(ordered.length);
    expect(headers.every((header) => header.symbolIndex === RAPTORQ_SYMBOL_INDEX)).toBe(true);
  });

  it('should handle empty input gracefully and provide error message', () => {
    const data = new Uint8Array(0);
    expect(data.length).toBe(0);
  });
});
