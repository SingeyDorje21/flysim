import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { BackSide, Mesh, ShaderMaterial, SphereGeometry } from 'three'
import type { TimeOfDay } from '../types'
import { displayColor, environmentFor, SKY_RADIUS } from './constants'

const VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

// Writes final display values (no tone mapping), so the horizon equals the fog colour exactly.
const FRAGMENT = /* glsl */ `
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float up = max(d.y, 0.0);
  vec3 col = mix(uHorizon, uZenith, pow(up, 0.55));
  col = mix(col, uHorizon * 0.9, clamp(-d.y * 3.0, 0.0, 1.0));

  float s = max(dot(d, uSunDir), 0.0);
  float lowSun = 1.0 - clamp(uSunDir.y, 0.0, 1.0);
  // Wide warm glow hugging the horizon, tighter halo, then the disc.
  col += uSunColor * pow(s, 5.0) * exp(-abs(d.y) * 5.0) * (0.25 + 0.5 * lowSun);
  col += uSunColor * pow(s, 28.0) * 0.30;
  col += uSunColor * pow(s, 500.0) * 0.55;
  float disc = smoothstep(0.99935, 0.99965, s) * smoothstep(-0.03, 0.02, d.y);
  col = mix(col, vec3(1.0, 0.98, 0.92), disc);
  gl_FragColor = vec4(col, 1.0);
}
`

/**
 * Gradient sky dome with a sun disc and glow, tinted per time of day. It is
 * re-centred on the camera every frame (place it after the camera rig), so a
 * 60 km camera far plane never clips it.
 */
export function Sky({ timeOfDay }: { timeOfDay: TimeOfDay }) {
  const ref = useRef<Mesh>(null)
  const camera = useThree((s) => s.camera)

  const resources = useMemo(() => {
    const geometry = new SphereGeometry(SKY_RADIUS, 32, 20)
    const look = environmentFor('noon')
    const material = new ShaderMaterial({
      uniforms: {
        uHorizon: { value: displayColor(look.horizonColor) },
        uZenith: { value: displayColor(look.zenithColor) },
        uSunDir: { value: look.sunDirection.clone() },
        uSunColor: { value: displayColor(look.sunColor) },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      side: BackSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
    })
    return { geometry, material }
  }, [])

  useEffect(() => {
    const look = environmentFor(timeOfDay)
    const u = resources.material.uniforms
    u.uHorizon.value.copy(displayColor(look.horizonColor))
    u.uZenith.value.copy(displayColor(look.zenithColor))
    u.uSunDir.value.copy(look.sunDirection)
    u.uSunColor.value.copy(displayColor(look.sunColor))
  }, [resources, timeOfDay])

  useEffect(
    () => () => {
      resources.geometry.dispose()
      resources.material.dispose()
    },
    [resources],
  )

  useFrame(() => {
    if (ref.current) ref.current.position.copy(camera.position)
  })

  return <mesh ref={ref} geometry={resources.geometry} material={resources.material} renderOrder={-1000} frustumCulled={false} />
}
