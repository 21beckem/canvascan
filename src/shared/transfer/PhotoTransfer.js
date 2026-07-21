import { Type } from '../utils/Type.js';
import { Config } from '../utils/Config.js';

/**
 * PhotoTransfer.js
 * Splits a photo payload (from PhotoCodec.encode) into fixed-size chunks and
 * sends them sequentially over a PeerJS DataConnection, with a simple
 * backpressure check against the underlying RTCDataChannel's
 * `bufferedAmount`. Chunking is done explicitly at the app level (rather
 * than relying solely on a library's internal binary chunking) because raw
 * (lossless) photos default to tens of megabytes, and we want a predictable,
 * well-under-typical-message-size-limit chunk size regardless of which
 * PeerJS version/browser is involved.
 *
 * Message shapes (all JSON-serializable except PHOTO_CHUNK's `bytes`, an
 * ArrayBuffer that PeerJS's default 'binary' serialization handles natively):
 *   { type: 'PHOTO_START', photoId, kind, format, width, height, totalBytes, totalChunks }
 *   { type: 'PHOTO_CHUNK', photoId, index, bytes }
 *   { type: 'PHOTO_END', photoId }
 */
export class PhotoTransfer {
  /**
   * Sends a full photo payload as a PHOTO_START / PHOTO_CHUNK* / PHOTO_END
   * sequence over the given connection.
   * @param {import('peerjs').DataConnection} conn
   * @param {{
   *   photoId: string,
   *   kind: 'ANCHOR' | 'DETAIL',
   *   format: 'raw' | 'jpeg',
   *   width: number,
   *   height: number,
   *   buffer: ArrayBuffer,
   * }} payload
   */
  static async sendPhoto(conn, { photoId, kind, format, width, height, buffer }) {
    Type.check({ conn }, 'object');
    Type.check({ photoId, kind, format }, 'string');
    Type.check({ width, height }, 'number');
    Type.check({ buffer }, ArrayBuffer);

    const chunkSize = Config.TRANSFER_CHUNK_SIZE;
    const totalBytes = buffer.byteLength;
    const totalChunks = Math.max(1, Math.ceil(totalBytes / chunkSize));

    await conn.send({
      type: 'PHOTO_START',
      photoId,
      kind,
      format,
      width,
      height,
      totalBytes,
      totalChunks,
    });

    for (let index = 0; index < totalChunks; index++) {
      await PhotoTransfer.#pace(conn, index);
      const start = index * chunkSize;
      const end = Math.min(totalBytes, start + chunkSize);
      await conn.send({ type: 'PHOTO_CHUNK', photoId, index, bytes: buffer.slice(start, end) });
    }

    await conn.send({ type: 'PHOTO_END', photoId });
  }

  /**
   * Paces chunk sending to avoid overwhelming the connection. Prefers
   * introspecting the underlying RTCDataChannel's `bufferedAmount` when
   * available, but that's an internal PeerJS implementation detail that has
   * moved across versions (older builds exposed it as `_dc`; current ones
   * may not expose it at all) — so this degrades gracefully to a small fixed
   * yield every few chunks if it isn't there, rather than assuming a
   * specific property name exists.
   */
  static async #pace(conn, chunkIndex) {
    Type.check({ conn }, 'object');
    Type.check({ chunkIndex }, 'number');

    const channel = conn?.dataChannel ?? conn?._dc ?? null;
    if (channel && typeof channel.bufferedAmount === 'number') {
      while (channel.bufferedAmount > Config.TRANSFER_BACKPRESSURE_THRESHOLD) {
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
      return;
    }
    if (chunkIndex % 4 === 3) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
}

/**
 * PhotoReceiver.js (co-located with PhotoTransfer)
 * Reassembles PHOTO_START/PHOTO_CHUNK/PHOTO_END sequences back into a full
 * `{photoId, kind, format, width, height, buffer}` payload. One instance can
 * track transfers from multiple simultaneous connections/photoIds at once
 * (photoIds are expected to be globally unique — see `makePhotoId`).
 */
export class PhotoReceiver {
  #pending;
  #onPhotoComplete;

  /**
   * @param {(payload: {photoId:string, kind:string, format:string, width:number, height:number, buffer:ArrayBuffer, senderId:string}) => void} onPhotoComplete
   */
  constructor(onPhotoComplete) {
    Type.check({ onPhotoComplete }, 'function');
    
    this.#pending = new Map();
    this.#onPhotoComplete = onPhotoComplete;
  }

  /**
   * Feeds one incoming data message. Ignores message types it doesn't
   * recognize (harmless no-op) so callers can pass every message through.
   * @param {unknown} msg
   * @param {string} senderId identifies which connection this came from
   */
  handleMessage(msg, senderId) {
    Type.check({ msg }, 'object');

    switch (msg.type) {
      case 'PHOTO_START': {
        this.#pending.set(msg.photoId, {
          kind: msg.kind,
          format: msg.format,
          width: msg.width,
          height: msg.height,
          totalBytes: msg.totalBytes,
          totalChunks: msg.totalChunks,
          receivedChunks: 0,
          bytes: new Uint8Array(msg.totalBytes),
          senderId,
        });
        break;
      }

      case 'PHOTO_CHUNK': {
        const entry = this.#pending.get(msg.photoId);
        if (!entry) return; // unknown/late chunk — ignore rather than throw
        const offset = msg.index * Config.TRANSFER_CHUNK_SIZE;
        entry.bytes.set(new Uint8Array(msg.bytes), offset);
        entry.receivedChunks++;
        break;
      }

      case 'PHOTO_END': {
        const entry = this.#pending.get(msg.photoId);
        this.#pending.delete(msg.photoId);
        if (!entry) return;
        this.#onPhotoComplete({
          photoId: msg.photoId,
          kind: entry.kind,
          format: entry.format,
          width: entry.width,
          height: entry.height,
          buffer: entry.bytes.buffer,
          senderId: entry.senderId,
        });
        break;
      }

      default:
        break;
    }
  }

  /** Drops any in-flight transfers associated with a connection that closed. */
  discardFrom(senderId) {
    Type.check({ senderId }, 'string');
    for (const [photoId, entry] of this.#pending.entries()) {
      if (entry.senderId === senderId) this.#pending.delete(photoId);
    }
  }
}

/** Generates a photoId that's unique across the whole pooled session. */
export function makePhotoId(clientId) {
  Type.check({ clientId }, 'string');
  const random =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${clientId}:${random}`;
}
