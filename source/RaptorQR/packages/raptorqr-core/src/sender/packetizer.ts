/**
 * Legacy JS RLNC sender packetizer — configurable QR profile, no manifest,
 * with outer RS.
 *
 * Steps:
 *   1. Optional metadata wrapping (filename + mime for files)
 *   2. Optional compression (deflate-raw)
 *   3. Split preprocessed data into selected-profile symbols
 *   4. Group into G source generations of K=16 symbols each
 *   5. Apply outer Reed-Solomon to create P parity generations
 *   6. RLNC encode all G+P generations (16 systematic + 8 coded each)
 *   7. Build transport packets with metadata in every header
 *
 * @module
 */

import { K, R, MAX_PAYLOAD_SIZE, parityCount } from '@raptorqr/core/protocol/constants';
import { PacketHeader, createPacket } from '@raptorqr/core/protocol/packet';
import { encodeGeneration } from '@raptorqr/core/fec/rlnc_encoder';
import { encodeOuterRS } from '@raptorqr/core/fec/outer_rs';
import { preprocessPayload } from '@raptorqr/core/sender/preprocess_payload';

export type { PreprocessResult } from '@raptorqr/core/sender/preprocess_payload';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PacketizerResult {
  packets: Uint8Array[];
  totalGenerations: number;
  sourceGenerations: number;
  dataLength: number;
  isText: boolean;
  isCompressed: boolean;
  symbolSize: number;
}

export interface PacketizerOptions {
  symbolSize?: number;
}

// ─── Packetizer ──────────────────────────────────────────────────────────────

/**
 * Encode raw data into legacy JS RLNC transport packets.
 *
 * @param data       Raw bytes to transmit
 * @param isText     Whether the payload is plain text
 * @param compress   Whether to apply deflate-raw compression
 * @param filename   Optional original filename (for file downloads)
 * @param mimeType   Optional MIME type (for file downloads)
 * @returns PacketizerResult containing all packets and metadata
 */
export function packetize(
  data: Uint8Array,
  isText: boolean,
  compress: boolean,
  filename?: string,
  mimeType?: string,
  options: PacketizerOptions = {},
): PacketizerResult {
  const symbolSize = normalizeSymbolSize(options.symbolSize);
  const preprocessed = preprocessPayload(data, isText, compress, filename, mimeType);
  const dataLength = preprocessed.dataLength;

  // 3. Split into fixed-size symbols
  const symbols: Uint8Array[] = [];
  for (let offset = 0; offset < dataLength; offset += symbolSize) {
    const chunk = preprocessed.data.slice(offset, offset + symbolSize);
    if (chunk.length < symbolSize) {
      const padded = new Uint8Array(symbolSize);
      padded.set(chunk);
      symbols.push(padded);
    } else {
      symbols.push(chunk);
    }
  }

  const totalSymbols = symbols.length;
  const sourceGenerations = Math.max(1, Math.ceil(totalSymbols / K));
  const P = parityCount(sourceGenerations);
  const totalGenerations = sourceGenerations + P;

  // 4. Build source chunks (K symbols each, padded with zeros if needed)
  const sourceChunks: Uint8Array[] = [];
  for (let gen = 0; gen < sourceGenerations; gen++) {
    const startIdx = gen * K;
    const genSymbolsCount = Math.min(K, totalSymbols - startIdx);
    const chunk = new Uint8Array(K * symbolSize);
    for (let i = 0; i < K; i++) {
      if (i < genSymbolsCount) {
        chunk.set(symbols[startIdx + i]!, i * symbolSize);
      }
      // else: leave as zeros (padding)
    }
    sourceChunks.push(chunk);
  }

  // 5. Apply outer Reed-Solomon to create parity chunks
  const parityChunks = encodeOuterRS(sourceChunks, P);

  // 6. RLNC encode all chunks and build packets
  const packets: Uint8Array[] = [];
  const allChunks = [...sourceChunks, ...parityChunks];

  for (let gen = 0; gen < allChunks.length; gen++) {
    const chunk = allChunks[gen]!;
    const isLastGen = gen === allChunks.length - 1;

    // Split chunk into K symbols
    const genSymbols: Uint8Array[] = [];
    for (let i = 0; i < K; i++) {
      genSymbols.push(chunk.slice(i * symbolSize, (i + 1) * symbolSize));
    }

    const codedSymbols = encodeGeneration(genSymbols, K, R, gen);

    // Systematic symbols: symbolIndex = sourceIndex (0–15)
    for (let i = 0; i < K; i++) {
      const cs = codedSymbols[i]!;
      const header: PacketHeader = {
        generationIndex: gen,
        totalGenerations: totalGenerations,
        symbolIndex: cs.sourceIndex,
        isText,
        isLastGeneration: isLastGen,
        compressed: preprocessed.isCompressed,
        dataLength,
      };
      packets.push(createPacket(header, cs.data));
    }

    // Coded symbols: symbolIndex = 16 + j
    for (let j = 0; j < R; j++) {
      const cs = codedSymbols[K + j]!;
      const header: PacketHeader = {
        generationIndex: gen,
        totalGenerations: totalGenerations,
        symbolIndex: 16 + j,
        isText,
        isLastGeneration: isLastGen,
        compressed: preprocessed.isCompressed,
        dataLength,
      };
      packets.push(createPacket(header, cs.data));
    }
  }

  return {
    packets,
    totalGenerations,
    sourceGenerations,
    dataLength,
    isText,
    isCompressed: preprocessed.isCompressed,
    symbolSize,
  };
}

function normalizeSymbolSize(value: number | undefined): number {
  if (value === undefined) return MAX_PAYLOAD_SIZE;
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`Invalid symbol size: ${value}`);
  }
  return value;
}
