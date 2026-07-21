# Canvascan

A tool for photographing a painting in overlapping pieces (one wide "anchor"
shot + many close-up "detail" shots) and stitching them into a single
high-resolution composite via feature matching and perspective warping.

## Pages

- **`index.html`** — home page. Shows a (currently placeholder) library of
  past scans and a "New Scan" button that routes based on device: desktop
  opens `host.html`; phone/touch devices open `scanner.html?peer=none`
  (fully local mode) directly.
- **`host.html`** — runs on a computer. Shows a QR code to pair one or more
  phones, then does the heavy lifting (OpenCV, WebGL2, export) for whichever
  phones connect to it.
- **`scanner.html`** — runs on a phone, in one of two modes depending on its
  `?peer=` query param:
  - `?peer=<hostId>` (via scanning a host's QR code) — **remote mode**: a
    deliberately thin camera client. No OpenCV, no WebGL2 — it just captures
    full-resolution frames and ships them to the host over PeerJS.
  - `?peer=none` (via index.html's "New Scan" on a phone, or navigating here
    directly) — **standalone mode**: the phone does everything itself,
    camera capture AND the full processing pipeline, no networking at all.

Any number of phones can be connected to one host session at once (pooled
capture) — any of them can contribute the anchor or any number of detail
photos; first accepted anchor wins.

## Running it

Static, no-build vanilla ES modules. Must be served over HTTPS (or
`localhost`) — camera access, Web Workers, and WebRTC all require a secure
context.

```bash
npx serve .
# or
python3 -m http.server 8000
```

## Architecture

```
src/
  shared/     <- used by ALL THREE modes (host, remote scanner, standalone)
    utils/       Config, Matrix3
    state/       AppStateMachine
    ui/          StatusOverlay, ProgressMap
    camera/      CameraController
    capture/     FrameGrabber
    transfer/    PhotoCodec (encode/decode), PhotoTransfer (chunked send/receive)
    render/      WebGL2Renderer, TileManager, ShaderProgram, TextureUploader, shaders/
    cv-worker/   cv.worker.js (classic worker), FeatureMatcher, FeatherMaskGenerator
    export/      CanvasExporter
    pipeline/    SessionPipeline  <- see below

  host/       <- host.html only: PeerJS transport (pooled), QR code, HostUIController
  scanner/    <- scanner.html: ScannerApp (router) + RemoteScannerApp (thin,
                 PeerJS client) + StandaloneApp (local capture + pipeline)
```

**`SessionPipeline`** (`src/shared/pipeline/SessionPipeline.js`) is the key
extraction that makes standalone mode possible without duplicating code: it
owns the OpenCV worker, the WebGL2 tiled renderer, and the progress grid, and
drives the anchor/detail-queue state machine — but knows nothing about
*where photos come from*. Callers call `submitAnchor(bitmap, tag)` /
`submitDetail(photoId, bitmap, tag)` and get results back through callbacks.
`HostApp.js` feeds it photos received over PeerJS (using each phone's peerId
as `tag`, so it can route per-sender acks back); `StandaloneApp.js` feeds it
photos captured from its own local camera (no `tag` needed, single user).
Both get the exact same processing — one implementation, not two.

**`ScannerApp.js`** is a thin router, not a mode implementation: it reads
`?peer=`, then `dynamic import()`s exactly one of `RemoteScannerApp.js` or
`StandaloneApp.js`. This is a genuine code-split — scanning a QR code never
downloads the OpenCV/WebGL2 bundle that `?peer=none` needs, so the common
case (pairing with a computer) stays exactly as thin as before.

### Photo transfer protocol (remote mode only)

Photos are encoded (`PhotoCodec.js`) as either raw RGBA pixels (default —
zero quality loss) or JPEG (`Config.PHOTO_TRANSFER_FORMAT = 'jpeg'` for much
faster/smaller transfers with minor generational loss), split into fixed-size
chunks (`Config.TRANSFER_CHUNK_SIZE`), and sent as `PHOTO_START` /
`PHOTO_CHUNK`* / `PHOTO_END` messages, reassembled by `PhotoReceiver` on the
host.

### Alignment performance

Feature detection/matching runs on a copy of each photo downscaled to
`Config.ALIGNMENT_WORK_MEGAPIXELS` (default 1.2MP) — mirroring OpenCV's own
reference `Stitcher` pipeline, which downscales to a "work_megapix" budget
for registration and only composites at full resolution. The resulting
homography is algebraically rescaled back to full-resolution coordinates
before compositing (`FeatureMatcher.js`) — actual output quality is never
downscaled, only the (otherwise very AKAZE-cost-sensitive) alignment step.

### Rendering

- Master canvas dimensions are computed from the anchor's own aspect ratio
  (long edge = `Config.LONG_EDGE_TARGET`, default 8192px) — not forced
  square — represented as a grid of `Config.TILE_SIZE` WebGL2 tile
  framebuffers.
- Blending uses `gl.blendFuncSeparate` (not `gl.blendFunc`) — the alpha
  channel needs different blend factors than RGB for correct accumulation
  over an already-opaque layer; using the same factors for both was
  quietly deflating alpha at feathered seams and letting the exporter's
  white background bleed through there.
- Export reads back all tile framebuffers, composites them, and downloads a
  JPEG cropped to the anchor's true aspect ratio.

## Known constraints / trade-offs

- Pinned CDN versions: OpenCV.js (`@techstark/opencv-js@4.10.0-release.1`),
  PeerJS (`1.5.5`), qrcodejs (`davidshimjs-qrcodejs@0.0.2`).
- Device detection for index.html's "New Scan" routing (`pointer: coarse` +
  narrow viewport) is a heuristic — touchscreen laptops/tablets can guess
  wrong either way.
- There's no "New Anchor"/reset control anywhere by design — restarting a
  session means reloading the page (host or standalone).
