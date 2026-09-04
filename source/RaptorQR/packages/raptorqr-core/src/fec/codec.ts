export type FecCodec = 'wasm-raptorq' | 'js-rlnc';
export type ReceiverFecCodec = 'auto' | FecCodec;

export interface FecCodecInfo {
  id: FecCodec;
  label: string;
  status: 'primary' | 'deprecated';
  description: string;
}

export const FEC_CODECS: FecCodecInfo[] = [
  {
    id: 'wasm-raptorq',
    label: 'RaptorQ WASM',
    status: 'primary',
    description: 'Primary RaptorQ fountain codec backed by WASM.',
  },
  {
    id: 'js-rlnc',
    label: 'JS RLNC',
    status: 'deprecated',
    description: 'Deprecated compatible RLNC codec retained for comparison and old flows.',
  },
];

export const DEFAULT_FEC_CODEC: FecCodec = 'wasm-raptorq';
export const DEFAULT_RECEIVER_FEC_CODEC: ReceiverFecCodec = 'auto';
export const DEFAULT_RAPTORQ_REPAIR_PERCENT = 10;
export const MIN_RAPTORQ_REPAIR_PERCENT = 0;
export const MAX_RAPTORQ_REPAIR_PERCENT = 100;

export function normalizeFecCodec(value: unknown): FecCodec {
  if (value === 'js-rlnc' || value === 'wasm-raptorq') {
    return value;
  }
  return DEFAULT_FEC_CODEC;
}

export function normalizeReceiverFecCodec(value: unknown): ReceiverFecCodec {
  if (value === 'auto' || value === 'js-rlnc' || value === 'wasm-raptorq') {
    return value;
  }
  return DEFAULT_RECEIVER_FEC_CODEC;
}

export function normalizeRaptorQRepairPercent(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_RAPTORQ_REPAIR_PERCENT;
  return Math.min(
    MAX_RAPTORQ_REPAIR_PERCENT,
    Math.max(MIN_RAPTORQ_REPAIR_PERCENT, Math.round(parsed)),
  );
}

export function formatFecCodec(value: FecCodec | ReceiverFecCodec): string {
  if (value === 'auto') return 'Auto';
  return value === 'wasm-raptorq'
    ? 'RaptorQ WASM'
    : 'JS RLNC (deprecated / compatible)';
}
