import { Type } from '../utils/Type.js';
/**
 * TextureUploader.js
 * Helpers for uploading ImageBitmaps (detail/anchor photos) and raw feather
 * alpha masks as WebGL2 textures. No Y-flip is applied on upload: the
 * fragment shader computes UVs directly from top-down pixel coordinates, and
 * WebGL's default (non-flipped) upload preserves the source's row order in
 * texture memory, so v=0 already corresponds to the top row of the source.
 */
export class TextureUploader {
  /**
   * Uploads an ImageBitmap as an RGBA8 WebGL2 texture.
   * @param {WebGL2RenderingContext} gl
   * @param {ImageBitmap} bitmap
   * @returns {WebGLTexture}
   */
  static uploadImageBitmap(gl, bitmap) {
    Type.check({ gl }, WebGL2RenderingContext);
    Type.check({ bitmap }, ImageBitmap);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return texture;
  }

  /**
   * Uploads a single-channel (Uint8ClampedArray) feather alpha mask as an R8
   * WebGL2 texture.
   * @param {WebGL2RenderingContext} gl
   * @param {{width:number, height:number, data:Uint8ClampedArray}} mask
   * @returns {WebGLTexture}
   */
  static uploadFeatherMask(gl, mask) {
    Type.check({ gl }, WebGL2RenderingContext);
    Type.check({ mask }, 'object');
    Type.check({ width: mask.width, height: mask.height }, 'number');
    Type.check({ data: mask.data }, Uint8ClampedArray);
    
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      mask.width,
      mask.height,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      new Uint8Array(mask.data.buffer, mask.data.byteOffset, mask.data.byteLength)
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return texture;
  }

  /**
   * Creates a solid, fully-opaque 1x1 R8 texture — used as a stand-in
   * feather texture when uUseFeather is false (skeleton paint pass).
   * @param {WebGL2RenderingContext} gl
   * @returns {WebGLTexture}
   */
  static createOpaqueStub(gl) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      1,
      1,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      new Uint8Array([255])
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return texture;
  }
}
