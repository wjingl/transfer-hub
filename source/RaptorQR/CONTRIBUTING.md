
# Contributing to RaptorQR

Thanks for your interest in RaptorQR.

This project focuses on high-speed offline file/text transfer through animated QR codes, with performance-critical paths backed by Rust/WASM. Contributions that improve reliability, throughput, browser compatibility, protocol clarity, tests, or documentation are welcome.


## Guidelines

- Keep changes focused and easy to review.
- Prefer existing architecture and package boundaries.
- Do not add new dependencies unless they are clearly justified.
- Keep protocol changes backward-compatible when possible.
- Do not silently fallback from `wasm-raptorq` to `js-rlnc`; codec choice should remain explicit.
- Add or update tests for behavior changes.
- Run `pnpm build` and `pnpm test` before submitting.

## WASM Artifacts

The repository includes precompiled WASM artifacts for convenience.

If you update Rust/WASM wrappers, also update the related build script and manifest. Generated artifacts should stay under:

```text
packages/raptorqr-fast-qr-wasm/src/wasm
packages/raptorqr-fast-qr-wasm/src/wasm
packages/raptorqr-raptorq-wasm/src/wasm
```

## Pull Requests

A good PR should include:

- A short description of the change
- Why the change is needed
- Any compatibility or performance impact
- Test results, including device/browser notes when relevant

Performance claims should include enough context to reproduce them: QR version, ECC level, parallel QR count, FPS, browser, device, and file size.

## Bug Reports

Please include:

- Browser and device
- RaptorQR version or commit
- Transfer mode: file/text, live/GIF, camera/GIF decode
- QR version, ECC, parallel QR count, FEC codec, and decoder settings
- Screenshots or logs if available

## Security

Please do not report security vulnerabilities in public issues. See `SECURITY.md` for private reporting guidance.
