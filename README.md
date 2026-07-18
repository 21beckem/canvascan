# Canvascan

A two-page tool for photographing a painting in overlapping pieces (one wide
"anchor" shot + many close-up "detail" shots) and stitching them into a
single high-resolution composite via feature matching and perspective
warping — no upload to any third-party server; photos flow directly
phone → computer over a peer-to-peer WebRTC connection.

## Pages

- **`host.html`** — runs on the computer. Shows a QR code to pair a phone,
  then does ALL the heavy lifting: OpenCV feature matching, WebGL2 tiled
  compositing, and JPEG export. This is the page you look at while shooting.
- **`scanner.html`** — runs on the phone (opened by scanning the QR code).
  A deliberately thin camera client: it captures full-resolution frames and
  ships them to the host. No OpenCV, no WebGL2 — this was moved off the
  phone specifically because it was too heavy for average phone hardware.

Any number of phones can be connected to one host session at once, and any
of them can contribute the (single, shared) anchor photo or any number of
detail photos — first accepted anchor wins; everyone's detail photos feed
the same shared queue.

## Running it

Static, no-build vanilla ES modules. Must be served over HTTPS (or
`localhost`) — camera access, Web Workers, and WebRTC all require a secure
context.

```bash
npx serve .
# or
python3 -m http.server 8000
```

Open `host.html` on the computer, scan the QR code with a phone's camera
app (not inside this app) to open `scanner.html?peer=<hostId>`.

Note: pairing uses PeerJS's free public cloud broker (`0.peerjs.com`) to
exchange connection info only — once connected, photo data flows directly
phone → computer, not through that broker.

## Architecture

- **`src/shared/`** — code used by both pages: `Config`, `Matrix3`,
  `AppStateMachine`, `StatusOverlay`, and `transfer/` (photo encode/decode +
  chunked send/receive over a PeerJS DataConnection).
- **`src/host/`** — host-only: `PeerHostManager` (pooled DataConnections),
  `QRCodeView`, the WebGL2 tiled renderer, the OpenCV `cv.worker.js` (a
  classic, non-module worker — see comments in `FeatureMatcher.js` for why),
  `CanvasExporter`, and the large `ProgressMap` grid.
- **`src/scanner/`** — scanner-only: `PeerScannerManager`, `CameraController`,
  `FrameGrabber`. No rendering or CV code at all.

### Photo transfer protocol

Photos are encoded (`PhotoCodec.js`) as either raw RGBA pixels (default —
zero quality loss, since detail photos are literally the source pixels in
the final export) or JPEG (set `Config.PHOTO_TRANSFER_FORMAT = 'jpeg'` for
much faster/smaller transfers with minor generational loss). The payload is
split into fixed-size chunks (`Config.TRANSFER_CHUNK_SIZE`, default 256KB)
and sent as `PHOTO_START` / `PHOTO_CHUNK`* / `PHOTO_END` messages
(`PhotoTransfer.js`), reassembled by `PhotoReceiver` on the host. Chunking is
done explicitly at the app level — rather than relying solely on a specific
PeerJS version's internal chunking — because raw/lossless photos default to
tens of megabytes.

### Session/pooling model

The host is the sole source of truth for session state (has-anchor,
in-flight/queued detail photos). Phones are thin and reactive:
- A newly-connected phone gets `ANCHOR_ESTABLISHED` immediately if the
  session already has one (so it skips straight to detail capture).
- If two phones race to set the anchor, the host's `#anchorInFlight` lock
  makes the loser get `ANCHOR_BUSY` (a benign nudge to try again seconds
  later) rather than corrupting the render pipeline.
- Each phone gets a per-photo ack (`DETAIL_ACK` / `ANCHOR_FAILED`) routed
  only to the sender that submitted that specific photo — not broadcast —
  so one phone's alignment failure doesn't spam every other connected phone.

### Rendering (unchanged from the single-device version)

- Master canvas dimensions are computed from the anchor's own aspect ratio
  (long edge = `Config.LONG_EDGE_TARGET`, default 8192px) — not forced
  square — represented as a grid of `Config.TILE_SIZE` WebGL2 tile
  framebuffers.
- Each detail photo is aligned via AKAZE/ORB + Lowe's ratio test + RANSAC
  homography (worker-side), producing a homography plus a distance-transform
  feather-alpha mask, composited onto every tile the warped quad overlaps.
- Export reads back all tile framebuffers, composites them, and downloads a
  JPEG cropped to the anchor's true aspect ratio.

## Known constraints / trade-offs

- Pinned CDN versions: OpenCV.js (`@techstark/opencv-js@4.10.0-release.1`),
  PeerJS (`1.5.5`), qrcodejs (`davidshimjs-qrcodejs@0.0.2`) — see the top of
  `Config.js` and the `<script>` tags in `host.html`/`scanner.html`.
- Backpressure pacing between chunk sends prefers introspecting the
  underlying `RTCDataChannel.bufferedAmount` but degrades gracefully to a
  small fixed yield if that isn't exposed by the PeerJS version in use (see
  comments in `PhotoTransfer.js`) — this is an internal implementation
  detail, not a stable public API, across PeerJS versions.
- There's no "New Anchor" control anywhere by design — restarting a session
  means reloading `host.html` (a fresh PeerJS id, fresh QR code).
