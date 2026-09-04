# @raptorqr/fast-qr-wasm

Generated [`fast_qr`](https://github.com/erwanvivien/fast_qr) wasm-bindgen artifacts used by RaptorQR for QR rendering.

Most application code should use `@raptorqr/core` instead of importing this package directly. This package exposes the raw renderer module for low-level integration, tests, and core wrappers.

## Exports

```ts
import init, {
  initSync,
  QrRenderer,
  type InitOutput,
} from '@raptorqr/fast-qr-wasm';
```

```text
default init(module_or_path?) -> Promise<InitOutput>
initSync(module) -> InitOutput
QrRenderer
InitOutput
```

`QrRenderer` methods:

```text
new QrRenderer()
render(data, version, ecc, scale) -> sidePx
render_rgba(data, version, ecc, scale) -> sidePx
render_matrix(data, version, ecc) -> sideModules
rgba_ptr() / rgba_len()
buf_ptr() / buf_len()
matrix_ptr() / matrix_len()
last_matrix_size()
free()
```

ECC numeric mapping:

```text
0 = L
1 = M
2 = Q
3 = H
```

## Render RGBA

```ts
import init, { QrRenderer } from '@raptorqr/fast-qr-wasm';

const wasm = await init();
const renderer = new QrRenderer();

const sidePx = renderer.render_rgba(packetBytes, 10, 1, 4);
const byteLength = sidePx * sidePx * 4;

const rgba = new Uint8ClampedArray(
  wasm.memory.buffer,
  renderer.rgba_ptr(),
  byteLength,
);

const copy = new Uint8ClampedArray(rgba);
```

Copy the view before another render call if you need to keep the pixels.

## Render Matrix

```ts
const sideModules = renderer.render_matrix(packetBytes, 10, 1);
const modules = new Uint8Array(
  wasm.memory.buffer,
  renderer.matrix_ptr(),
  sideModules * sideModules,
);
```

`modules[row * sideModules + col]` is `0` for light and `1` for dark.

## WASM Asset Subpath

The generated files are exported for bundlers and Node loaders:

```text
@raptorqr/fast-qr-wasm/wasm/*
```

The binary sidecar is:

```text
src/wasm/raptorqr_fast_qr_wasm_bg.wasm
```

## Regeneration

The Colab build script is:

```text
src/build_fast_qr_wasm_colab.py
```

After regenerating artifacts, run:

```bash
pnpm --filter @raptorqr/fast-qr-wasm test
pnpm --filter @raptorqr/core test
```
