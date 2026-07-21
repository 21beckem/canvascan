import { Type } from '../utils/Type.js';
import { Config } from '../utils/Config.js';
import { Matrix3 } from '../utils/Matrix3.js';
import { TileManager } from './TileManager.js';
import { ShaderProgram } from './ShaderProgram.js';
import { TextureUploader } from './TextureUploader.js';
import warpVertSrc from './shaders/warp.vert.js';
import warpFragSrc from './shaders/warp.frag.js';

/**
 * WebGL2Renderer.js
 * Owns the WebGL2 context (against a normal, non-offscreen canvas element —
 * all WebGL2 work happens on the main thread) and the tiled framebuffer
 * system representing the logical Master Canvas as a grid of tiles.
 *
 * The Master Canvas's dimensions are NOT fixed/square: they are computed
 * once, from the anchor photo's own aspect ratio, the first time
 * `configureForAnchor()` runs (see that method). The tile grid is padded up
 * to whole tiles, but the true (unpadded) output size is tracked separately
 * and used by CanvasExporter to crop off that padding at export time.
 *
 * The canvas backing this context is never itself drawn to as a visible
 * composite — all rendering targets individual tile framebuffers, which are
 * later read back directly (see CanvasExporter.js) for export.
 */
export class WebGL2Renderer {
  #gl;
  #tileManager;
  #tiles; // Map<"row,col", {texture, framebuffer}>
  #shader;
  #quadVAO;
  #quadVBO;
  #anchorToMaster;
  #anchorTexture;
  #outputWidth;
  #outputHeight;
  #opaqueFeatherStub;

  constructor(gl) {
    this.#gl = gl;
    this.#tileManager = null;
    this.#tiles = new Map();
    this.#anchorToMaster = null;
    this.#anchorTexture = null;
    this.#outputWidth = 0;
    this.#outputHeight = 0;
  }

  /**
   * Creates the WebGL2 context on the given canvas element. Tile
   * framebuffers are NOT allocated yet — that happens in
   * `configureForAnchor()` once the anchor photo's aspect ratio is known.
   * @param {HTMLCanvasElement} canvasElement
   * @returns {WebGL2Renderer}
   * @throws {Error} with `.userMessage` if WebGL2 is unavailable.
   */
  static create(canvasElement) {
    Type.check({ canvasElement }, HTMLCanvasElement);
    const gl = canvasElement.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      preserveDrawingBuffer: false,
    });

    if (!gl) {
      const err = new Error('WebGL2Renderer: WebGL2 context unavailable.');
      err.userMessage = 'This browser/device does not support WebGL2.';
      throw err;
    }

    const renderer = new WebGL2Renderer(gl);
    renderer.#init();
    return renderer;
  }

  #init() {
    const gl = this.#gl;

    this.#shader = ShaderProgram.fromSources(gl, warpVertSrc, warpFragSrc);

    // Shared quad geometry buffer; contents rewritten per draw call to the
    // sub-rectangle of the tile currently being painted.
    this.#quadVAO = gl.createVertexArray();
    this.#quadVBO = gl.createBuffer();
    gl.bindVertexArray(this.#quadVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#quadVBO);
    gl.bufferData(gl.ARRAY_BUFFER, 4 * 2 * 4, gl.DYNAMIC_DRAW); // 4 verts * vec2 * f32
    const posLoc = this.#shader.attribLocation('aPosition');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.#opaqueFeatherStub = TextureUploader.createOpaqueStub(gl);

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    // RGB channels: standard "over" — srcColor*srcAlpha + dstColor*(1-srcAlpha).
    // Alpha channel: MUST use a different factor pair (ONE / ONE_MINUS_SRC_ALPHA)
    // so it accumulates as srcAlpha + dstAlpha*(1-srcAlpha). Using the single
    // gl.blendFunc(SRC_ALPHA, ONE_MINUS_SRC_ALPHA) call applies SRC_ALPHA to
    // the alpha channel too, which computes srcAlpha*srcAlpha + dstAlpha*(1-
    // srcAlpha) instead — quietly deflating alpha below 1.0 at every
    // partially-feathered edge, even over an already-opaque anchor. That
    // under-opacity then let CanvasExporter's white background bleed through
    // at every seam between stitched photos.
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  #allocateTile() {
    const gl = this.#gl;
    const size = this.#tileManager.tileSize;

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`WebGL2Renderer: incomplete tile framebuffer (status ${status}).`);
    }

    gl.viewport(0, 0, size, size);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);

    return { texture, framebuffer };
  }

  #key(row, col) {
    Type.check({ row, col }, 'number');
    return `${row},${col}`;
  }

  #disposeTiles() {
    const gl = this.#gl;
    for (const tile of this.#tiles.values()) {
      gl.deleteTexture(tile.texture);
      gl.deleteFramebuffer(tile.framebuffer);
    }
    this.#tiles.clear();
  }

  /**
   * Computes the Master Canvas's true output dimensions from the anchor
   * photo's aspect ratio (longer edge = Config.LONG_EDGE_TARGET), (re)
   * allocates the tile grid to cover it, uploads the anchor as a texture,
   * establishes the anchor-to-master similarity transform, and paints the
   * anchor across every tile as the initial "skeleton" layer.
   *
   * Safe to call again (e.g. on "retake anchor") — any previously allocated
   * tiles are disposed first and the grid is resized to the new anchor's
   * aspect ratio.
   * @param {ImageBitmap} anchorBitmap
   * @returns {{outputWidth: number, outputHeight: number}}
   */
  configureForAnchor(anchorBitmap) {
    Type.check({ anchorBitmap }, 'ImageBitmap');
    const gl = this.#gl;
    const longEdge = Config.LONG_EDGE_TARGET;

    let outputWidth;
    let outputHeight;
    if (anchorBitmap.width >= anchorBitmap.height) {
      outputWidth = longEdge;
      outputHeight = Math.round(longEdge * (anchorBitmap.height / anchorBitmap.width));
    } else {
      outputHeight = longEdge;
      outputWidth = Math.round(longEdge * (anchorBitmap.width / anchorBitmap.height));
    }
    this.#outputWidth = outputWidth;
    this.#outputHeight = outputHeight;

    this.#disposeTiles();
    this.#tileManager = TileManager.forContentSize(outputWidth, outputHeight, Config.TILE_SIZE);
    for (const { row, col } of this.#tileManager.allTiles()) {
      this.#tiles.set(this.#key(row, col), this.#allocateTile());
    }

    // The output aspect ratio is chosen to match the anchor's exactly, so
    // this transform is a pure uniform scale with no translation/centering.
    const scale = outputWidth / anchorBitmap.width;
    this.#anchorToMaster = Matrix3.fromScaleTranslate(scale, 0, 0);

    if (this.#anchorTexture) {
      gl.deleteTexture(this.#anchorTexture);
    }
    this.#anchorTexture = TextureUploader.uploadImageBitmap(gl, anchorBitmap);

    this.#paintAnchorSkeleton(anchorBitmap.width, anchorBitmap.height);

    return { outputWidth, outputHeight };
  }

  #paintAnchorSkeleton(anchorWidth, anchorHeight) {
    Type.check({ anchorWidth, anchorHeight }, 'number');
    const gl = this.#gl;
    const invTransform = Matrix3.invert(this.#anchorToMaster);
    const size = this.#tileManager.tileSize;

    this.#shader.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.#anchorTexture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.#opaqueFeatherStub);
    gl.uniform1i(this.#shader.uniformLocation('uColorTex'), 0);
    gl.uniform1i(this.#shader.uniformLocation('uFeatherTex'), 1);
    gl.uniform1i(this.#shader.uniformLocation('uUseFeather'), 0);
    gl.uniform2f(this.#shader.uniformLocation('uDetailSize'), anchorWidth, anchorHeight);
    gl.uniform1f(this.#shader.uniformLocation('uTileSize'), size);
    gl.uniformMatrix3fv(this.#shader.uniformLocation('uInvTransform'), true, invTransform);

    for (const { row, col } of this.#tileManager.allTiles()) {
      const origin = this.#tileManager.tileOrigin(row, col);
      const tile = this.#tiles.get(this.#key(row, col));

      gl.bindFramebuffer(gl.FRAMEBUFFER, tile.framebuffer);
      gl.viewport(0, 0, size, size);
      gl.uniform2f(this.#shader.uniformLocation('uTileOrigin'), origin.x, origin.y);

      this.#drawQuad(0, 0, size, size);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** @returns {boolean} whether the anchor skeleton has been painted yet. */
  hasAnchor() {
    return this.#anchorToMaster !== null;
  }

  /**
   * Warps and alpha-feather-blends a detail photo onto every tile its
   * projected quad intersects.
   * @param {{
   *   detailBitmap: ImageBitmap,
   *   homography: number[],
   *   featherMask: {width:number, height:number, data:Uint8ClampedArray},
   *   detailWidth: number,
   *   detailHeight: number,
   * }} params
   * @returns {{minX:number, minY:number, maxX:number, maxY:number}} the
   *   master-canvas bounding box that was touched (for progress mapping).
   */
  stitchDetail(o) {
    Type.check({ o }, 'object');
    const { detailBitmap, homography, featherMask, detailWidth, detailHeight } = o;
    Type.check({ detailBitmap }, ImageBitmap);
    Type.check({ homography }, 'array');
    Type.check({ featherMask }, 'object');
    Type.check({ 'featherMask.width': featherMask.width, 'featherMask.height': featherMask.height }, 'number');
    Type.check({ detailWidth, detailHeight }, 'number');
    if (!this.hasAnchor()) {
      throw new Error('WebGL2Renderer.stitchDetail: no anchor has been painted yet.');
    }

    const gl = this.#gl;
    const size = this.#tileManager.tileSize;

    const combinedForward = Matrix3.multiply(this.#anchorToMaster, homography);
    const combinedInverse = Matrix3.invert(combinedForward);

    const corners = [
      [0, 0],
      [detailWidth, 0],
      [detailWidth, detailHeight],
      [0, detailHeight],
    ];
    const projected = Matrix3.applyToPoints(combinedForward, corners);
    const bbox = Matrix3.boundingBox(projected);

    const intersecting = this.#tileManager.tilesIntersectingBBox(
      bbox.minX,
      bbox.minY,
      bbox.maxX,
      bbox.maxY
    );

    if (intersecting.length === 0) {
      return bbox;
    }

    const detailTexture = TextureUploader.uploadImageBitmap(gl, detailBitmap);
    const featherTexture = TextureUploader.uploadFeatherMask(gl, featherMask);

    try {
      this.#shader.use();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, detailTexture);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, featherTexture);
      gl.uniform1i(this.#shader.uniformLocation('uColorTex'), 0);
      gl.uniform1i(this.#shader.uniformLocation('uFeatherTex'), 1);
      gl.uniform1i(this.#shader.uniformLocation('uUseFeather'), 1);
      gl.uniform2f(this.#shader.uniformLocation('uDetailSize'), detailWidth, detailHeight);
      gl.uniform1f(this.#shader.uniformLocation('uTileSize'), size);
      gl.uniformMatrix3fv(this.#shader.uniformLocation('uInvTransform'), true, combinedInverse);
      gl.uniform2f(this.#shader.uniformLocation('uFeatherBBoxMin'), bbox.minX, bbox.minY);
      gl.uniform2f(this.#shader.uniformLocation('uFeatherBBoxMax'), bbox.maxX, bbox.maxY);

      for (const tile of intersecting) {
        const framebufferEntry = this.#tiles.get(this.#key(tile.tileRow, tile.tileCol));
        const origin = this.#tileManager.tileOrigin(tile.tileRow, tile.tileCol);

        gl.bindFramebuffer(gl.FRAMEBUFFER, framebufferEntry.framebuffer);
        gl.viewport(0, 0, size, size);
        gl.uniform2f(this.#shader.uniformLocation('uTileOrigin'), origin.x, origin.y);

        this.#drawQuad(tile.subMinX, tile.subMinY, tile.subMaxX, tile.subMaxY);
      }
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteTexture(detailTexture);
      gl.deleteTexture(featherTexture);
    }

    return bbox;
  }

  /**
   * Draws a single axis-aligned quad, in tile-local pixel coordinates, as a
   * triangle fan using the shared dynamic VBO.
   */
  #drawQuad(minX, minY, maxX, maxY) {
    Type.check({ minX, minY, maxX, maxY }, 'number');
    const gl = this.#gl;
    const verts = new Float32Array([minX, minY, maxX, minY, maxX, maxY, minX, maxY]);
    gl.bindVertexArray(this.#quadVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#quadVBO);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, verts);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    gl.bindVertexArray(null);
  }

  /**
   * Reads back the raw RGBA pixels of a single tile's framebuffer.
   * NOTE: per WebGL's readPixels convention, row 0 of the returned buffer is
   * the BOTTOM row of the tile as authored by this renderer's top-left pixel
   * convention (see warp.vert.js) — callers (CanvasExporter) must flip
   * vertically when compositing into a top-down image.
   * @param {number} row
   * @param {number} col
   * @returns {Uint8Array} length = tileSize*tileSize*4
   */
  readTilePixels(row, col) {
    Type.check({ row, col }, 'number');
    const gl = this.#gl;
    const size = this.#tileManager.tileSize;
    const tile = this.#tiles.get(this.#key(row, col));
    const pixels = new Uint8Array(size * size * 4);

    gl.bindFramebuffer(gl.FRAMEBUFFER, tile.framebuffer);
    gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    return pixels;
  }

  get tileManager() {
    return this.#tileManager;
  }

  get anchorToMaster() {
    return this.#anchorToMaster;
  }

  /** @returns {{width:number, height:number}} the true (unpadded) output size. */
  get outputSize() {
    return { width: this.#outputWidth, height: this.#outputHeight };
  }

  dispose() {
    const gl = this.#gl;
    this.#disposeTiles();
    if (this.#anchorTexture) gl.deleteTexture(this.#anchorTexture);
    gl.deleteTexture(this.#opaqueFeatherStub);
    gl.deleteBuffer(this.#quadVBO);
    gl.deleteVertexArray(this.#quadVAO);
    this.#shader.dispose();
  }
}
