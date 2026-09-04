/**
 * Production roundtrip test: mimics the production app flow.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_RAPTORQ_REPAIR_PERCENT } from '@raptorqr/core/fec/codec';
import { RaptorQWasmDecoder } from '@raptorqr/core/fec/raptorq_wasm';
import { renderQRCodeImageData } from '@raptorqr/core/qr/qr_encoder_browser';
import { createQRGif } from '@raptorqr/core/gif/gif_render';
import { parseGif, renderGifFrame } from '@raptorqr/core/gif/gif_parser';
import { decodeQRFromCanvas } from '@raptorqr/core/qr/qr_decode';
import { parsePacket } from '@raptorqr/core/protocol/packet';
import { inflateSync } from 'fflate';
import {
  MAX_PAYLOAD_SIZE,
  QR_VERSION,
  ECC_LEVEL,
  FRAME_DELAY_MS,
} from '@raptorqr/core/protocol/constants';
import { packetizeRaptorQ } from '@raptorqr/core/sender/raptorq_packetizer';

describe('Production Roundtrip', () => {
  it('should transfer a binary payload via GIF with frame loss', async () => {
    const payload = new Uint8Array(2500);
    crypto.getRandomValues(payload);

    const result = await packetizeRaptorQ(
      payload,
      false,
      true,
      undefined,
      undefined,
      {
        maxTransportPayloadSize: MAX_PAYLOAD_SIZE,
        repairPercent: DEFAULT_RAPTORQ_REPAIR_PERCENT,
      },
    );
    const frames = result.packets;

    // Build GIF (production path)
    const imageFrames: Uint8Array[] = [];
    let width = 0;
    let height = 0;
    for (const frame of frames) {
      const imageData = await renderQRCodeImageData(frame, QR_VERSION, ECC_LEVEL, 4, 'fast-qr-wasm');
      if (width === 0) {
        width = imageData.width;
        height = imageData.height;
      }
      imageFrames.push(new Uint8Array(imageData.data.buffer));
    }
    const gifBytes = createQRGif(imageFrames, FRAME_DELAY_MS, width, height);

    // Parse GIF (receiver file-upload path)
    const gifData = parseGif(gifBytes);

    // Decode with deterministic frame loss below the default repair budget.
    const keepIndices = new Set<number>();
    for (let i = 0; i < gifData.frames.length; i++) {
      if ((i + 1) % 12 !== 0) keepIndices.add(i);
    }

    const decoder = await RaptorQWasmDecoder.create(result.dataLength, MAX_PAYLOAD_SIZE);
    let decoded: Uint8Array | null = null;

    for (let i = 0; i < gifData.frames.length; i++) {
      if (!keepIndices.has(i)) continue;

      const rgba = renderGifFrame(gifData, i);
      const imageData = new ImageData(rgba, gifData.width, gifData.height);
      const decodedQR = await decodeQRFromCanvas(imageData);
      if (!decodedQR) continue;

      const pkt = parsePacket(decodedQR.bytes);
      decoded = decoder.push(pkt.payload);
      if (decoded) break;
    }

    expect(decoded).not.toBeNull();
    const assembled = decoded!.slice(0, result.dataLength);
    const recovered = result.isCompressed ? inflateSync(assembled) : assembled;

    expect(recovered).toEqual(payload);
  });
});
