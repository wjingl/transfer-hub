# @raptorqr/cli

Terminal sender and local web-app preview server for RaptorQR.

## Usage

Display a local file as a looping terminal QR stream:

```bash
raptorqr document.pdf
```

Display text from stdin:

```bash
echo "Hello, world!" | raptorqr
```

Serve the built web app locally:

```bash
raptorqr --serve --port 8080
```

`raptorqr document.pdf` reads the local file, preserves filename and MIME metadata, and displays RaptorQ transport packets as QR codes in the terminal. It does not upload the file, create a URL, or write a new output file. Scan the stream with the RaptorQR receiver to reconstruct the file.

Press `q` or `Ctrl-C` to stop the terminal sender.

## Build Output

The package builds to:

```text
dist/raptorqr.js
```

The build also copies required WASM sidecars into `dist/`:

```text
raptorqr_fast_qr_wasm_bg.wasm
raptorqr_raptorq_wasm_bg.wasm
```

Run the repository build before publishing:

```bash
pnpm build
```
