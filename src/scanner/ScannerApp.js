import { Config } from '../shared/utils/Config.js';

/**
 * ScannerApp.js
 * Entry-point router for scanner.html. Reads the `peer` query param and
 * dynamically imports exactly one of two composition roots:
 *   - `?peer=none`     -> StandaloneApp (local camera + full processing
 *                         pipeline, no networking at all)
 *   - `?peer=<hostId>` -> RemoteScannerApp (thin camera client, ships full-
 *                         resolution photos to a host.html over PeerJS)
 *
 * This is a real code-split, not just an if/else: RemoteScannerApp's module
 * graph never touches SessionPipeline (OpenCV worker, WebGL2 renderer), and
 * StandaloneApp's never touches PeerScannerManager — so scanning a QR code
 * still gets the deliberately thin, phone-friendly client, and only
 * `?peer=none` pays for the heavier local-processing bundle.
 */
const params = new URLSearchParams(window.location.search);
const peerParam = params.get(Config.PEER_ID_QUERY_PARAM);

if (peerParam === 'none') {
  const { StandaloneApp } = await import('./StandaloneApp.js');
  new StandaloneApp().start();
} else {
  const { RemoteScannerApp } = await import('./RemoteScannerApp.js');
  new RemoteScannerApp().start();
}
