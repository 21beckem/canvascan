import { Type } from '../shared/utils/Type.js';
/**
 * PeerHostManager.js
 * Wraps a PeerJS `Peer` in "host" mode: gets a random id from the public
 * PeerJS cloud broker, accepts incoming DataConnections from any number of
 * phones (pooled — every connected phone can contribute photos), and
 * exposes a small event-callback surface to the rest of the host app.
 *
 * Assumes the global `Peer` class is already available (host.html loads the
 * PeerJS UMD bundle via a plain <script> tag, ahead of the type="module"
 * script, so it's guaranteed to exist by the time this module runs).
 */
export class PeerHostManager {
  #peer;
  #connections;
  #onClientConnected;
  #onClientDisconnected;
  #onMessage;

  /**
   * @param {{
   *   onHostReady: (hostPeerId: string) => void,
   *   onHostError: (err: Error) => void,
   *   onClientConnected: (peerId: string, connectionCount: number) => void,
   *   onClientDisconnected: (peerId: string, connectionCount: number) => void,
   *   onMessage: (peerId: string, data: unknown) => void,
   * }} handlers
   */
  constructor(o) {
    Type.check({ parameters: o }, 'object');
    const { onHostReady, onHostError, onClientConnected, onClientDisconnected, onMessage } = o;
    Type.check({ onHostReady, onHostError, onClientConnected, onClientDisconnected, onMessage }, 'function');

    this.#connections = new Map();
    this.#onClientConnected = onClientConnected;
    this.#onClientDisconnected = onClientDisconnected;
    this.#onMessage = onMessage;

    // eslint-disable-next-line no-undef
    this.#peer = new Peer();
    this.#peer.on('open', (id) => onHostReady(id));
    this.#peer.on('error', (err) => onHostError(err));
    this.#peer.on('connection', (conn) => this.#registerConnection(conn));
  }

  #registerConnection(conn) {
    Type.check({ conn }, 'object');
    conn.on('open', () => {
      this.#connections.set(conn.peer, conn);
      this.#onClientConnected(conn.peer, this.#connections.size);
    });
    conn.on('data', (data) => this.#onMessage(conn.peer, data));
    conn.on('close', () => this.#dropConnection(conn.peer));
    conn.on('error', () => this.#dropConnection(conn.peer));
  }

  #dropConnection(peerId) {
    Type.check({ peerId }, 'string');
    if (!this.#connections.has(peerId)) return;
    this.#connections.delete(peerId);
    this.#onClientDisconnected(peerId, this.#connections.size);
  }

  /** Sends `data` to every currently-open phone connection. */
  broadcast(data) {
    Type.check({ data }, 'object');
    for (const conn of this.#connections.values()) {
      if (conn.open) conn.send(data);
    }
  }

  /** @param {string} peerId @param {unknown} data */
  sendTo(peerId, data) {
    Type.check({ peerId }, 'string');
    Type.check({ data }, 'object');
    const conn = this.#connections.get(peerId);
    if (conn?.open) conn.send(data);
  }

  /** @returns {number} number of currently-connected phones. */
  get connectionCount() {
    return this.#connections.size;
  }

  /** @returns {string | undefined} this host's PeerJS id, once assigned. */
  get hostPeerId() {
    return this.#peer.id;
  }
}
