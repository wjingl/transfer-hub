export const CIMBAR_RUNTIME_BASE = './cimbar/';

export interface CimbarRuntimeStatus {
  available: boolean;
  missing: string[];
}

const REQUIRED_ASSETS = [
  'cimbar_js.js',
  'cimbar_js.wasm',
  'send.js',
  'send-worker.js',
  'recv.js',
  'recv-worker.js',
  'zstd.js',
] as const;

export async function checkCimbarRuntime(): Promise<CimbarRuntimeStatus> {
  const missing: string[] = [];
  await Promise.all(REQUIRED_ASSETS.map(async (asset) => {
    try {
      const response = await fetch(`${CIMBAR_RUNTIME_BASE}${asset}`, { method: 'HEAD', cache: 'no-store' });
      if (!response.ok) missing.push(asset);
    } catch {
      missing.push(asset);
    }
  }));
  return { available: missing.length === 0, missing };
}

export function cimbarWorkerUrl(name: 'send-worker.js' | 'recv-worker.js' | 'cimbar-recv-worker.js'): string {
  return `${CIMBAR_RUNTIME_BASE}${name}`;
}
