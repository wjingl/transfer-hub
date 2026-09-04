# @raptorqr/raptorq-wasm

Generated [`cberner/raptorq`](https://github.com/cberner/raptorq) wasm-bindgen artifacts used by RaptorQR for RaptorQ encoding and decoding.

Most application code should use `@raptorqr/core` instead of importing this package directly. This package exposes the raw codec module for low-level integration, tests, and core wrappers.

## Exports

```ts
import init, {
  initSync,
  encode_packets,
  RaptorQDecoder,
} from '@raptorqr/raptorq-wasm';
```

```text
default init(module_or_path?) -> Promise<InitOutput>
initSync(module) -> InitOutput
encode_packets(data, max_transport_payload_size, repair_percent) -> Array<any>
RaptorQDecoder
```

`RaptorQDecoder` methods:

```text
new RaptorQDecoder(data_len, max_transport_payload_size)
push(serialized_packet) -> Uint8Array | null
free()
```

## Encode And Decode

```ts
import init, {
  encode_packets,
  RaptorQDecoder,
} from '@raptorqr/raptorq-wasm';

await init();

const data = new TextEncoder().encode('hello');
const maxTransportPayloadSize = 201;
const repairPercent = 10;

const packets = Array.from(
  encode_packets(data, maxTransportPayloadSize, repairPercent),
  (packet) => new Uint8Array(packet),
);

const decoder = new RaptorQDecoder(data.length, maxTransportPayloadSize);

let decoded: Uint8Array | null = null;
for (const packet of packets) {
  const result = decoder.push(packet);
  if (result) {
    decoded = new Uint8Array(result);
    break;
  }
}
```

Direct RaptorQ packets are codec payloads only. They do not include the RaptorQR 8-byte transport header, CRC32C trailer, compression metadata, filename metadata, or QR scheduling semantics. Use `@raptorqr/core/sender/raptorq_packetizer` when you need complete RaptorQR transfer packets.

## WASM Asset Subpath

The generated files are exported for bundlers and Node loaders:

```text
@raptorqr/raptorq-wasm/wasm/*
```

The binary sidecar is:

```text
src/wasm/raptorqr_raptorq_wasm_bg.wasm
```

## Verification

```bash
pnpm --filter @raptorqr/raptorq-wasm test
```

## Regeneration

The Colab build script is:

```text
src/build_raptorq_wasm_colab.py
```

After regenerating artifacts, run:

```bash
pnpm --filter @raptorqr/raptorq-wasm test
pnpm --filter @raptorqr/core test
```
