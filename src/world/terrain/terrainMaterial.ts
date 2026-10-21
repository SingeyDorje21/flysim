/**
 * Terrain ground material: a MeshStandardMaterial patched in onBeforeCompile,
 * so scene lights, shadows and fog keep working. The fragment colour blends
 * seabed, sand, grass, dry grass, forest floor, alpine meadow, rock on steep
 * slopes and snow on high, flatter ground, with procedural detail noise that
 * fades in near the camera.
 */

import { Color, MeshStandardMaterial } from 'three'

const PALETTE = {
  uSeabedDeep: 0x2d5a5c,
  uSeabed: 0x8a9a7a,
  uSand: 0xd8c896,
  uGrass: 0x5d8f3a,
  uGrassLush: 0x4a8233,
  uDryGrass: 0x9b9b52,
  uForest: 0x3b5a2a,
  uAlpine: 0x7f8452,
  uRock: 0x7c766e,
  uRockDark: 0x57524c,
  uSnow: 0xf2f5fa,
} as const

const VERTEX_PARS = /* glsl */ `
attribute vec2 biome;
varying vec2 vBiome;
varying vec3 vTerrainPos;
varying vec3 vTerrainNormal;
`

const VERTEX_MAIN = /* glsl */ `
vBiome = biome;
// Chunks are only translated, so the object normal is the world normal.
vTerrainNormal = normal;
vTerrainPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
`

const FRAGMENT_PARS = /* glsl */ `
varying vec2 vBiome;
varying vec3 vTerrainPos;
varying vec3 vTerrainNormal;
uniform vec3 uSeabedDeep;
uniform vec3 uSeabed;
uniform vec3 uSand;
uniform vec3 uGrass;
uniform vec3 uGrassLush;
uniform vec3 uDryGrass;
uniform vec3 uForest;
uniform vec3 uAlpine;
uniform vec3 uRock;
uniform vec3 uRockDark;
uniform vec3 uSnow;

float tHash(vec2 p) {
  p = mod(p, 4096.0);
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float tNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = tHash(i);
  float b = tHash(i + vec2(1.0, 0.0));
  float c = tHash(i + vec2(0.0, 1.0));
  float d = tHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
`

const FRAGMENT_COLOR = /* glsl */ `
{
  vec2 wp = vTerrainPos.xz;
  float h = vTerrainPos.y;
  vec3 tn = normalize(vTerrainNormal);
  float slope = 1.0 - tn.y;
  float dist = length(vTerrainPos - cameraPosition);
  float forest = vBiome.x;
  float dry = vBiome.y;

  float macro = tNoise(wp * 0.0021);
  float mid = tNoise(wp * 0.017);
  float nearFade = 1.0 - smoothstep(250.0, 1400.0, dist);
  float fineFade = 1.0 - smoothstep(25.0, 220.0, dist);
  float d1 = nearFade > 0.0 ? tNoise(wp * 0.21) : 0.5;
  float d2 = fineFade > 0.0 ? tNoise(wp * 1.3) : 0.5;

  // Grassland: lush / dry patches, forest floor under the woods, alpine meadow up high.
  vec3 col = mix(uGrass, uGrassLush, smoothstep(0.3, 0.8, mid));
  col = mix(col, uDryGrass, clamp(dry * (0.35 + 0.9 * macro) - 0.1, 0.0, 0.85));
  float alpine = smoothstep(650.0, 1050.0, h + 180.0 * (macro - 0.5));
  col = mix(col, uForest, forest * 0.85 * (1.0 - alpine) * (1.0 - smoothstep(0.14, 0.26, slope)));
  col = mix(col, uAlpine, alpine);

  // Rock on steep slopes and above the meadows.
  float rockiness = smoothstep(0.14, 0.3, slope + 0.1 * (mid - 0.5));
  rockiness = max(rockiness, smoothstep(1150.0, 1450.0, h + 200.0 * (macro - 0.5)) * 0.85);
  vec3 rock = mix(uRockDark, uRock, smoothstep(0.2, 0.8, mid * 0.6 + d1 * 0.4));
  col = mix(col, rock, rockiness);

  // Snow on high, flat-ish ground.
  float snow = smoothstep(1280.0, 1460.0, h + 160.0 * (macro - 0.5)) * (1.0 - smoothstep(0.3, 0.5, slope));
  col = mix(col, uSnow, snow);

  // Beaches and shallow sea floor.
  float beach = 1.0 - smoothstep(1.6, 3.8 + 2.0 * mid, h);
  col = mix(col, uSand, beach * (1.0 - smoothstep(0.35, 0.6, slope)));
  if (h < 0.0) {
    col = mix(uSand, uSeabed, smoothstep(0.0, -6.0, h));
    col = mix(col, uSeabedDeep, smoothstep(-6.0, -60.0, h));
  }

  // Close-up detail: blotches at a few metres, grain below a metre.
  col *= mix(1.0, 0.8 + 0.4 * d1, nearFade * 0.9);
  col *= mix(1.0, 0.88 + 0.24 * d2, fineFade);
  col *= 0.92 + 0.16 * macro;
  diffuseColor.rgb *= col;
}
`

/** Shared terrain material; dispose it when the terrain unmounts. */
export function createTerrainMaterial(): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 })
  const uniforms: Record<string, { value: Color }> = {}
  for (const [name, hex] of Object.entries(PALETTE)) uniforms[name] = { value: new Color(hex) }
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_MAIN}`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAGMENT_COLOR}`)
  }
  material.customProgramCacheKey = () => 'flysim-terrain-v1'
  return material
}
