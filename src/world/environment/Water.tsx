import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  Color,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
} from 'three'
import type { QualityProfile } from '../../config/quality'
import type { TimeOfDay } from '../types'
import { displayColor, environmentFor } from './constants'
import { snapWaterCenter } from './envMath'

/** Side of the water square (m). Covers the 100 km world and the horizon beyond the 60 km far plane. */
const WATER_SIZE = 140000

const VERTEX = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}
`

// Waves only bend the normal; the surface itself stays flat at y = 0 for physics.
// Output is final display values (no tone mapping), matching the sky and fog.
const FRAGMENT = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform float uLight;
varying vec3 vWorld;

// Slope (d height / d xz) of one sine wave of the given wavelength and height.
vec2 wave(vec2 p, vec2 dir, float len, float amp, float fade) {
  float k = 6.2831853 / len;
  float w = sqrt(9.81 * k);
  float ph = dot(dir, p) * k + uTime * w;
  return dir * (amp * k * cos(ph) * fade);
}

void main() {
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  vec2 p = vWorld.xz;

  // Fine octaves fade out with distance, so the far sea does not shimmer.
  vec2 s = vec2(0.0);
  s += wave(p, normalize(vec2(1.0, 0.35)), 90.0, 0.9, 1.0 - smoothstep(4000.0, 12000.0, dist));
  s += wave(p, normalize(vec2(-0.4, 1.0)), 37.0, 0.36, 1.0 - smoothstep(1800.0, 6000.0, dist));
  s += wave(p, normalize(vec2(0.8, -0.7)), 15.0, 0.14, 1.0 - smoothstep(700.0, 2500.0, dist));
  s += wave(p, normalize(vec2(-0.9, -0.3)), 6.3, 0.05, 1.0 - smoothstep(250.0, 900.0, dist));
  s += wave(p, normalize(vec2(0.2, 1.0)), 2.6, 0.02, 1.0 - smoothstep(80.0, 350.0, dist));

  vec3 N = normalize(vec3(-s.x, 1.0, -s.y));
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fres = mix(0.05, 1.0, pow(1.0 - ndv, 4.0));

  vec3 R = reflect(-V, N);
  float ry = clamp(R.y, 0.0, 1.0);
  vec3 sky = mix(uHorizon, uZenith, pow(ry, 0.5));

  // Depth-free shallow tint: lighter at glancing angles and on wave faces.
  float tint = clamp(0.2 + 0.55 * pow(1.0 - ndv, 1.5) + length(s) * 1.2, 0.0, 1.0);
  vec3 body = mix(uDeep, uShallow, tint) * uLight;
  vec3 col = mix(body, sky, fres);

  float sd = max(dot(R, uSunDir), 0.0) * step(0.0, R.y);
  float glint = pow(sd, 700.0) * 6.0 + pow(sd, 70.0) * 0.4;
  col += uSunColor * glint;

  // Slightly see-through near the camera so the seabed tints the coast.
  float alpha = clamp(0.82 + 0.18 * fres + smoothstep(1500.0, 8000.0, dist) * 0.18, 0.0, 1.0);
  alpha = max(alpha, clamp(glint, 0.0, 1.0));

  gl_FragColor = vec4(col, alpha);
  #include <logdepthbuf_fragment>
  #include <fog_fragment>
}
`

/**
 * Ocean plane at y = 0 that follows the camera in x/z (snapped), so it always
 * reaches the horizon. 'animated' is a wave shader (normals only, Fresnel sky
 * reflection, sun glint, fog and log depth aware); 'simple' is a tinted
 * standard material. Terrain under the sea is negative, so the shore is
 * resolved by the logarithmic depth buffer.
 */
export function Water({ profile, timeOfDay }: { profile: QualityProfile; timeOfDay: TimeOfDay }) {
  const ref = useRef<Mesh>(null)
  const camera = useThree((s) => s.camera)
  const animated = profile.waterDetail === 'animated'

  const geometry = useMemo(() => {
    const g = new PlaneGeometry(WATER_SIZE, WATER_SIZE, 1, 1)
    g.rotateX(-Math.PI / 2)
    return g
  }, [])

  const material = useMemo(() => {
    const look = environmentFor('noon')
    if (animated) {
      return new ShaderMaterial({
        uniforms: UniformsUtils.merge([
          UniformsLib.fog,
          {
            uTime: { value: 0 },
            uSunDir: { value: new Vector3() },
            uSunColor: { value: new Color() },
            uDeep: { value: new Color() },
            uShallow: { value: new Color() },
            uHorizon: { value: new Color() },
            uZenith: { value: new Color() },
            uLight: { value: look.waterLight },
          },
        ]),
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        fog: true,
        transparent: true,
      })
    }
    return new MeshStandardMaterial({ roughness: 0.3, metalness: 0.05, transparent: true, opacity: 0.86 })
  }, [animated])

  useEffect(() => {
    const look = environmentFor(timeOfDay)
    if (material instanceof ShaderMaterial) {
      const u = material.uniforms
      u.uSunDir.value.copy(look.sunDirection)
      u.uSunColor.value.copy(displayColor(look.sunColor))
      u.uDeep.value.copy(displayColor(look.waterDeep))
      u.uShallow.value.copy(displayColor(look.waterShallow))
      u.uHorizon.value.copy(displayColor(look.horizonColor))
      u.uZenith.value.copy(displayColor(look.zenithColor))
      u.uLight.value = look.waterLight
    } else {
      material.color.set(look.waterDeep).lerp(new Color(look.waterShallow), 0.35).multiplyScalar(look.waterLight)
    }
  }, [material, timeOfDay])

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  useFrame((state) => {
    const m = ref.current
    if (!m) return
    m.position.x = snapWaterCenter(camera.position.x)
    m.position.z = snapWaterCenter(camera.position.z)
    if (material instanceof ShaderMaterial) material.uniforms.uTime.value = state.clock.elapsedTime
  })

  return <mesh ref={ref} geometry={geometry} material={material} position={[0, 0, 0]} renderOrder={1} frustumCulled={false} />
}
