'use strict';

let initialized = false;
let pendingFrames = [];
const buffers = new Map();

var Module = {
  preRun: [],
  locateFile() {
    return new URL('./cimbar_js.wasm', self.location.href).toString();
  },
  onRuntimeInitialized() {
    initialized = true;
    self.postMessage({ type: 'ready' });
    const queued = pendingFrames;
    pendingFrames = [];
    for (const frame of queued) {
      void processFrame(frame);
    }
  },
};

importScripts('./cimbar_js.js');

self.onmessage = (event) => {
  const message = event.data || {};
  if (message.type === 'configure') {
    if (!initialized) return;
    const mode = Number(message.mode || 0);
    if (mode > 0) Module._cimbard_configure_decode(mode);
    return;
  }
  if (message.type !== 'frame') return;

  // Frames that arrive before the WASM runtime is ready are queued and
  // processed once initialization completes instead of failing.
  if (!initialized) {
    pendingFrames.push(message);
    return;
  }
  void processFrame(message);
};

async function processFrame(message) {
  try {
    const pixels = new Uint8Array(message.pixels);
    const image = alloc('image', pixels.length);
    image.set(pixels);
    const output = alloc('fountain', Math.max(1, Module._cimbard_get_bufsize()));
    const format = message.format === 'NV12' ? 12 : message.format === 'I420' ? 420 : 4;
    const length = Module._cimbard_scan_extract_decode(
      image.byteOffset,
      message.width,
      message.height,
      format,
      output.byteOffset,
      output.length,
    );

    if (length <= 0) {
      self.postMessage({ type: 'scan', result: length === 0 ? 'empty' : 'miss' });
      self.postMessage({ type: 'frameDone' });
      return;
    }

    const packet = new Uint8Array(Module.HEAPU8.buffer, output.byteOffset, length).slice();
    const packetHeap = alloc('packet', packet.length);
    packetHeap.set(packet);
    const decodeResult = Module._cimbard_fountain_decode(packetHeap.byteOffset, packetHeap.length);
    const report = readReport();
    const progress = Array.isArray(report) ? report : undefined;
    if (progress) self.postMessage({ type: 'progress', progress });

    const complete = typeof decodeResult === 'bigint' ? decodeResult > 0n : decodeResult > 0;
    if (complete) {
      const id = Number(decodeResult);
      const result = await readResult(id);
      self.postMessage({ type: 'complete', ...result }, result.data ? [result.data] : []);
    } else {
      self.postMessage({ type: 'scan', result: 'packet', report: typeof report === 'string' ? report : undefined });
      self.postMessage({ type: 'frameDone' });
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    self.postMessage({ type: 'frameDone' });
  }
}

function alloc(name, size) {
  let view = buffers.get(name);
  if (!view || view.length < size || view.buffer !== Module.HEAPU8.buffer) {
    if (view) {
      try { Module._free(view.byteOffset); } catch {}
    }
    const ptr = Module._malloc(size);
    view = new Uint8Array(Module.HEAPU8.buffer, ptr, size);
    buffers.set(name, view);
  }
  return view;
}

function readReport() {
  const target = alloc('report', 4096);
  const length = Module._cimbard_get_report(target.byteOffset, target.length);
  if (length <= 0) return '';
  const text = new TextDecoder().decode(new Uint8Array(Module.HEAPU8.buffer, target.byteOffset, length));
  try { return JSON.parse(text); } catch { return text; }
}

async function readResult(id) {
  const filenameBuffer = alloc('filename', 1024);
  const filenameLength = Module._cimbard_get_filename(id, filenameBuffer.byteOffset, filenameBuffer.length);
  const filename = filenameLength > 0
    ? new TextDecoder().decode(new Uint8Array(Module.HEAPU8.buffer, filenameBuffer.byteOffset, filenameLength))
    : '';
  const chunkSize = Math.max(1, Module._cimbard_get_decompress_bufsize());
  const chunkBuffer = alloc('decompressed', chunkSize);
  const chunks = [];
  let total = 0;
  while (true) {
    const length = Module._cimbard_decompress_read(id, chunkBuffer.byteOffset, chunkBuffer.length);
    if (length <= 0) break;
    const chunk = new Uint8Array(Module.HEAPU8.buffer, chunkBuffer.byteOffset, length).slice();
    chunks.push(chunk);
    total += chunk.length;
  }
  const data = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  return { filename: filename || 'cimbar-recovered.bin', mime: 'application/octet-stream', data: data.buffer };
}

function fail(message) {
  self.postMessage({ type: 'error', message });
}
