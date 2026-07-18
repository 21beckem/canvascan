/**
 * warp.vert.js
 * Vertex shader for the tile warp/blend pass. Consumes tile-local pixel
 * coordinates for the quad being drawn (either the full tile, or a
 * bounding-box-restricted sub-rectangle for efficiency) and converts them to
 * clip space, flipping Y so that (0,0) is the top-left of the tile — this
 * keeps the whole pipeline in a single top-left-origin pixel convention,
 * matching how images and homographies are naturally expressed.
 */
export default `#version 300 es

// Tile-local pixel-space position of this vertex (0..uTileSize on each axis).
in vec2 aPosition;

// Size (px) of one square tile (e.g. 2048.0).
uniform float uTileSize;

// Passed through unchanged; the fragment shader adds the tile's master-space
// origin to recover the true master-canvas pixel position per fragment.
out vec2 vTileLocalPos;

void main() {
  vTileLocalPos = aPosition;

  vec2 ndc = (aPosition / uTileSize) * 2.0 - 1.0;
  // Flip Y: our convention is Y-down (top-left origin), clip space is Y-up.
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
}
`;
