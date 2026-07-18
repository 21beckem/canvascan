/**
 * PeerScannerManager.js
 * Wraps a PeerJS `Peer` in "client" mode: gets a random id from the public
 * PeerJS cloud broker, then opens one DataConnection to the host whose id
 * was encoded in the QR code / URL the phone scanned.
 *
 * Assumes the global `Peer` class is already available (scanner.html loads
 * the PeerJS UMD bundle via a plain <script> tag ahead of the type="module"
 * script).
 */
export class PeerScannerManager {
  #peer;
  #conn;
  #hostPeerId;

  /**
   * @param {{
   *   hostPeerId: string,
   *   onConnected: () => void,
   *   onDisconnected: () => void,
   *   onMessage: (data: unknown) => void,
   *   onError: (err: Error) => void,
   * }} params
   */
  constructor({ hostPeerId, onConnected, onDisconnected, onMessage, onError }) {
    this.#hostPeerId = hostPeerId;
    this.#conn = null;

    // eslint-disable-next-line no-undef
    this.#peer = new Peer();

    this.#peer.on('open', () => {
      const conn = this.#peer.connect(this.#hostPeerId, { reliable: true });
      this.#conn = conn;
      conn.on('open', () => onConnected());
      conn.on('data', (data) => onMessage(data));
      conn.on('close', () => onDisconnected());
      conn.on('error', (err) => onError(err));
    });

    this.#peer.on('error', (err) => onError(err));
  }

  /** @param {unknown} data */
  send(data) {
    if (this.#conn?.open) this.#conn.send(data);
  }

  /** @returns {boolean} whether the DataConnection to the host is currently open. */
  isConnected() {
    return Boolean(this.#conn?.open);
  }

  /** @returns {import('peerjs').DataConnection | null} for use with PhotoTransfer.sendPhoto. */
  get connection() {
    return this.#conn;
  }

  /** @returns {string | undefined} this phone's own PeerJS id, once assigned. */
  get peerId() {
    return this.#peer.id;
  }
}
