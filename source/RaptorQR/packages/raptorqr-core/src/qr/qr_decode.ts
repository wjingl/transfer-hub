/**
 * QR code decoding wrapper.
 *
 * Uses ZXing-C++ via `zxing-wasm/reader` to extract QR payloads from raw
 * pixel data. The wasm file is loaded from the bundled local asset, not the
 * package's default CDN path.
 */
import {
  BINARIZERS,
  CHARACTER_SETS,
  EAN_ADD_ON_SYMBOLS,
  TEXT_MODES,
  encodeFormats,
  prepareZXingModule,
  type ZXingReaderModule,
  type ZXingReaderOptions,
  type ZXingReadResult,
  type ZXingVector,
} from 'zxing-wasm/reader';
import { zxingReaderWasmUrl } from '@raptorqr/core/qr/zxing_assets';
import {
  DECODE_PRESETS,
  DEFAULT_DECODE_SETTINGS,
  normalizeDecodeSettings,
  type QrDecodeSettings,
} from '@raptorqr/core/qr/decode_settings';

export interface QrDecodeResult {
  bytes: Uint8Array;
  version: number;
}

export type QrDecodeOptions = Partial<Omit<QrDecodeSettings, 'maxSymbols'>> & {
  maxSymbols?: number;
};

type DeletableZXingVector<T> = ZXingVector<T> & {
  delete?: () => void;
};

type RuntimeZXingReaderModule = ZXingReaderModule & {
  HEAPU8: Uint8Array;
  _malloc: (size: number) => number;
  _free: (ptr: number) => void;
};

const QR_ONLY_FORMATS = encodeFormats(['QRCode']);
const EAN_ADD_ON_IGNORE = EAN_ADD_ON_SYMBOLS.indexOf('Ignore');
const TEXT_MODE_PLAIN = TEXT_MODES.indexOf('Plain');
const CHARACTER_SET_UNKNOWN = CHARACTER_SETS.indexOf('Unknown');
const DEFAULT_MAX_QR_SYMBOLS = 4;
const MAX_QR_SYMBOLS = 8;
const SINGLE_QR_DECODE_OPTIONS: Required<QrDecodeOptions> = {
  ...DEFAULT_DECODE_SETTINGS,
  ...DECODE_PRESETS.robust,
  maxSymbols: 1,
};

let preparePromise: Promise<RuntimeZXingReaderModule> | null = null;
let grayscaleScratch: Uint8Array | null = null;

/**
 * Decode a QR code from an `ImageData` object (e.g. from a `<canvas>`).
 *
 * Returns raw bytes and QR version. Returns null if no QR code is found.
 *
 * @param imageData  RGBA pixel data from a canvas (width × height × 4 bytes)
 * @returns The decoded QR payload and version, or `null` if no QR code could be found/decoded.
 */
export function decodeQRFromCanvas(
  imageData: ImageData,
): Promise<QrDecodeResult | null> {
  return decodeImageData(imageData, SINGLE_QR_DECODE_OPTIONS)
    .then((results) => results[0] ?? null);
}

/**
 * Decode up to `maxSymbols` QR codes from an `ImageData` object.
 */
export function decodeQRCodesFromCanvas(
  imageData: ImageData,
  options: number | QrDecodeOptions = DEFAULT_MAX_QR_SYMBOLS,
): Promise<QrDecodeResult[]> {
  return decodeImageData(imageData, normalizeDecodeOptions(options));
}

/**
 * Decode a QR code from a grayscale byte buffer.
 *
 * The grayscale data is expanded into an RGBA `ImageData` before decoding.
 *
 * @param grayBuffer  Flat luma array, length = width × height
 * @param width       Image width in pixels
 * @param height      Image height in pixels
 * @returns The decoded QR payload and version, or `null` if no QR code could be found/decoded.
 */
export function decodeQRFromBuffer(
  grayBuffer: Uint8Array,
  width: number,
  height: number,
): Promise<QrDecodeResult | null> {
  if (grayBuffer.length !== width * height) {
    throw new Error(
      `Buffer size mismatch: expected ${width}×${height} = ${width * height} ` +
      `grayscale pixels, got ${grayBuffer.length}`,
    );
  }

  // Build RGBA buffer where each grayscale value becomes an identical R/G/B
  // with full opacity.
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < grayBuffer.length; i++) {
    const g = grayBuffer[i]!;
    const off = i * 4;
    rgba[off]     = g;  // R
    rgba[off + 1] = g;  // G
    rgba[off + 2] = g;  // B
    rgba[off + 3] = 255; // A
  }

  return decodeImageData(new ImageData(rgba, width, height), SINGLE_QR_DECODE_OPTIONS)
    .then((results) => results[0] ?? null);
}

async function decodeImageData(
  imageData: ImageData,
  options: Required<QrDecodeOptions>,
): Promise<QrDecodeResult[]> {
  const reader = await prepareReader();
  return readQRCodesWithManualRelease(reader, imageData, options);
}

function prepareReader(): Promise<RuntimeZXingReaderModule> {
  if (!preparePromise) {
    preparePromise = prepareZXingModule({
      overrides: {
        locateFile: (path: string) => path.endsWith('.wasm') ? zxingReaderWasmUrl : path,
      },
      equalityFn: Object.is,
      fireImmediately: true,
    }) as Promise<RuntimeZXingReaderModule>;
  }
  return preparePromise;
}

function readQRCodesWithManualRelease(
  reader: RuntimeZXingReaderModule,
  imageData: ImageData,
  options: Required<QrDecodeOptions>,
): QrDecodeResult[] {
  const grayscale = rgbaToGrayscale(imageData);
  const bufferPtr = reader._malloc(grayscale.byteLength);
  if (!bufferPtr) {
    throw new Error(`Failed to allocate ${grayscale.byteLength} bytes in WASM memory`);
  }

  let results: DeletableZXingVector<ZXingReadResult> | null = null;
  try {
    reader.HEAPU8.set(grayscale, bufferPtr);
    results = reader.readBarcodesFromPixmap(
      bufferPtr,
      imageData.width,
      imageData.height,
      toZXingReaderOptions(options),
    ) as DeletableZXingVector<ZXingReadResult>;

    const decoded: QrDecodeResult[] = [];
    for (let index = 0; index < results.size(); index++) {
      const result = results.get(index);
      if (!result?.isValid || result.symbology !== 'QRCode' || result.bytes.length === 0) {
        continue;
      }
      decoded.push({
        bytes: new Uint8Array(result.bytes),
        version: parseQRVersion(result.version, result.extra),
      });
    }
    return decoded;
  } finally {
    results?.delete?.();
    reader._free(bufferPtr);
  }
}

function rgbaToGrayscale(imageData: ImageData): Uint8Array {
  const pixelCount = imageData.width * imageData.height;
  const expectedLength = pixelCount * 4;
  if (imageData.data.length !== expectedLength) {
    throw new Error(
      `ImageData size mismatch: expected ${expectedLength} RGBA bytes, got ${imageData.data.length}`,
    );
  }

  if (!grayscaleScratch || grayscaleScratch.length < pixelCount) {
    grayscaleScratch = new Uint8Array(pixelCount);
  }

  const gray = grayscaleScratch.subarray(0, pixelCount);
  const rgba = imageData.data;
  for (let pixel = 0, offset = 0; pixel < pixelCount; pixel++, offset += 4) {
    gray[pixel] = (306 * rgba[offset]! + 601 * rgba[offset + 1]! + 117 * rgba[offset + 2]! + 512) >> 10;
  }
  return gray;
}

function toZXingReaderOptions(options: Required<QrDecodeOptions>): ZXingReaderOptions {
  return {
    formats: QR_ONLY_FORMATS,
    tryHarder: options.tryHarder,
    tryRotate: options.tryRotate,
    tryInvert: options.tryInvert,
    tryDownscale: options.tryDownscale,
    tryDenoise: false,
    binarizer: encodeBinarizer(options.binarizer),
    isPure: false,
    downscaleThreshold: 500,
    downscaleFactor: options.downscaleFactor,
    minLineCount: 2,
    maxNumberOfSymbols: clampMaxSymbols(options.maxSymbols),
    validateOptionalChecksum: false,
    returnErrors: false,
    eanAddOnSymbol: EAN_ADD_ON_IGNORE,
    textMode: TEXT_MODE_PLAIN,
    characterSet: CHARACTER_SET_UNKNOWN,
    tryCode39ExtendedMode: true,
  };
}

function encodeBinarizer(binarizer: QrDecodeSettings['binarizer']): number {
  const index = BINARIZERS.indexOf(binarizer);
  return index >= 0 ? index : BINARIZERS.indexOf(DEFAULT_DECODE_SETTINGS.binarizer);
}

function parseQRVersion(version: string, extra: string): number {
  const parsedVersion = Number.parseInt(version, 10);
  if (Number.isFinite(parsedVersion) && parsedVersion > 0) {
    return parsedVersion;
  }

  try {
    const parsedExtra = JSON.parse(extra) as { Version?: unknown };
    const extraVersion = Number.parseInt(String(parsedExtra.Version ?? ''), 10);
    if (Number.isFinite(extraVersion) && extraVersion > 0) {
      return extraVersion;
    }
  } catch {
    // Ignore malformed or empty extra metadata.
  }

  return 0;
}

function clampMaxSymbols(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_QR_SYMBOLS;
  return Math.min(MAX_QR_SYMBOLS, Math.max(1, Math.round(value)));
}

function normalizeDecodeOptions(options: number | QrDecodeOptions): Required<QrDecodeOptions> {
  if (typeof options === 'number') {
    return {
      ...DEFAULT_DECODE_SETTINGS,
      maxSymbols: clampMaxSymbols(options),
    };
  }

  const { maxSymbols, ...readerSettings } = options;
  const normalizedSettings = normalizeDecodeSettings(readerSettings);
  return {
    ...normalizedSettings,
    maxSymbols: clampMaxSymbols(maxSymbols ?? DEFAULT_MAX_QR_SYMBOLS),
  };
}
