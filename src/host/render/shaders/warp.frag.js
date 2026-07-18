/**
 * warp.frag.js
 * Fragment shader performing the inverse-homography lookup from master
 * canvas pixel space into detail-image pixel space, discarding fragments
 * outside the detail image's bounds, then compositing the sampled detail
 * color modulated by a distance-transform feather alpha sampled from a
 * small bounding-box-relative feather texture.
 *
 * When uUseFeather is false (used for the initial anchor "skeleton" paint,
 * which has no feather mask), the feather term is treated as fully opaque.
 */
export default `#version 300 es
precision highp float;

in vec2 vTileLocalPos;

// Master-canvas pixel-space origin (top-left) of the tile being rendered.
uniform vec2 uTileOrigin;

// Row-major 3x3 matrix mapping a MASTER-canvas pixel (homogeneous) to a
// DETAIL-image pixel (homogeneous, requires perspective divide). Uploaded
// with transpose=true so GLSL "m * v" matches row-major authoring order.
uniform mat3 uInvTransform;

// Native pixel dimensions of the detail (or anchor, for the skeleton pass)
// image currently bound to uColorTex.
uniform vec2 uDetailSize;

// Bounding box (master-canvas pixel space) of the warped quad, used to
// derive the UV at which to sample the feather mask.
uniform vec2 uFeatherBBoxMin;
uniform vec2 uFeatherBBoxMax;

uniform sampler2D uColorTex;
uniform sampler2D uFeatherTex;
uniform bool uUseFeather;

out vec4 fragColor;

void main() {
  vec2 masterPos = uTileOrigin + vTileLocalPos;

  vec3 detailHomog = uInvTransform * vec3(masterPos, 1.0);
  vec2 detailPixel = detailHomog.xy / detailHomog.z;
  vec2 detailUV = detailPixel / uDetailSize;

  if (detailUV.x < 0.0 || detailUV.x > 1.0 || detailUV.y < 0.0 || detailUV.y > 1.0) {
    discard;
  }

  vec4 color = texture(uColorTex, detailUV);

  float featherAlpha = 1.0;
  if (uUseFeather) {
    vec2 bboxSize = max(uFeatherBBoxMax - uFeatherBBoxMin, vec2(1e-6));
    vec2 featherUV = (masterPos - uFeatherBBoxMin) / bboxSize;
    featherUV = clamp(featherUV, 0.0, 1.0);
    featherAlpha = texture(uFeatherTex, featherUV).r;
  }

  fragColor = vec4(color.rgb, color.a * featherAlpha);
}
`;
