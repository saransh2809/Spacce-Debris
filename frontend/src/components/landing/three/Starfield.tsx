import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { scene } from '../lib/sceneStore'
import type { LayerState } from '../lib/sceneStore'

/* ============================================================================
   STARFIELD (spec 9)
   Three shells at different radii. Because they sit far outside the camera's
   working volume but are still part of the scene graph, the camera move itself
   produces the parallax — the near shell slides against the far one. Each shell
   also rotates, extremely slowly and at its own rate.
   ========================================================================== */

interface StarLayerSpec {
  radius: number
  count: number
  size: number
  drift: number
  brightness: number
}

const LAYERS: StarLayerSpec[] = [
  { radius: 46, count: 1500, size: 2.4, drift: 0.0022, brightness: 1.0 },
  { radius: 78, count: 2200, size: 2.0, drift: 0.0013, brightness: 0.85 },
  { radius: 130, count: 2600, size: 1.6, drift: 0.0007, brightness: 0.7 },
]

const vert = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  attribute vec3  aColor;

  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uTwinkle;

  varying vec3  vColor;
  varying float vTwinkle;
  varying float vAtten;

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;

    float tw = 1.0 - uTwinkle + uTwinkle * (0.72 + 0.28 * sin(uTime * 0.55 + aPhase * 6.2831));
    float size = aSize * uPixelRatio * tw * (38.0 / max(1.0, -mv.z));

    // Faint stars want to be smaller than a pixel. Clamping the size alone
    // would make them all equally bright, so trade the size we could not take
    // back into alpha — that keeps the magnitude distribution intact.
    float clamped = max(size, 1.0);
    vAtten = size / clamped;
    gl_PointSize = clamped;

    vColor   = aColor;
    vTwinkle = tw;
  }
`

const frag = /* glsl */ `
  uniform float uOpacity;
  uniform float uBrightness;

  varying vec3  vColor;
  varying float vTwinkle;
  varying float vAtten;

  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    // Tight core with a short halo — reads as a star, not a blob.
    float a = pow(smoothstep(0.5, 0.08, d), 2.4);
    gl_FragColor = vec4(vColor, a * uOpacity * uBrightness * vTwinkle * vAtten);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

/** Deterministic PRNG so the sky is identical on every load and screenshot. */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function buildLayer(layer: StarLayerSpec, seed: number) {
  const rand = rng(seed)
  const n = layer.count
  const positions = new Float32Array(n * 3)
  const colors = new Float32Array(n * 3)
  const sizes = new Float32Array(n)
  const phases = new Float32Array(n)

  const c = new THREE.Color()

  for (let i = 0; i < n; i++) {
    // Uniform on the sphere.
    const u = rand() * 2 - 1
    const theta = rand() * Math.PI * 2
    const s = Math.sqrt(1 - u * u)
    positions[i * 3] = layer.radius * s * Math.cos(theta)
    positions[i * 3 + 1] = layer.radius * u
    positions[i * 3 + 2] = layer.radius * s * Math.sin(theta)

    // Loose stellar-class distribution: mostly white, a cool majority, a warm tail.
    const roll = rand()
    if (roll > 0.94) c.setHSL(0.07, 0.55, 0.72)       // warm giants
    else if (roll > 0.82) c.setHSL(0.11, 0.28, 0.82)  // yellow
    else if (roll > 0.32) c.setHSL(0.58, 0.16, 0.9)   // white
    else c.setHSL(0.6, 0.35, 0.86)                    // blue-white
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b

    // Heavy-tailed magnitudes: many faint, a few obviously bright.
    sizes[i] = layer.size * (0.5 + Math.pow(rand(), 2.8) * 1.3)
    phases[i] = rand()
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3))
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1))
  return geo
}

function StarLayer({ layer, seed, layersRef }: { layer: StarLayerSpec; seed: number; layersRef: React.RefObject<LayerState> }) {
  const ref = useRef<THREE.Points>(null)
  const matRef = useRef<THREE.ShaderMaterial>(null)
  const geometry = useMemo(() => buildLayer(layer, seed), [layer, seed])

  /* Initial values only. R3F clones this when it applies the prop, so the live
     uniforms are reached through matRef — see ConjunctionPair for the details. */
  const init = useMemo(
    () => ({
      uTime: { value: 0 },
      uOpacity: { value: 1 },
      uBrightness: { value: layer.brightness },
      uPixelRatio: { value: Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio : 1) },
      uTwinkle: { value: 0.22 },
    }),
    [layer.brightness]
  )

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    const u = matRef.current?.uniforms
    if (u) {
      u.uTime.value += dt
      u.uTwinkle.value = scene.reducedMotion ? 0 : 0.22
      u.uOpacity.value += (layersRef.current.stars - u.uOpacity.value) * 0.06
    }
    if (ref.current && !scene.reducedMotion) {
      ref.current.rotation.y += layer.drift * dt
      ref.current.rotation.x += layer.drift * 0.18 * dt
    }
  })

  return (
    <points ref={ref} geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        ref={matRef}
        vertexShader={vert}
        fragmentShader={frag}
        uniforms={init}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  )
}

export function Starfield({ layersRef }: { layersRef: React.RefObject<LayerState> }) {
  const layers = useMemo(
    () =>
      scene.isMobile
        ? LAYERS.map((l) => ({ ...l, count: Math.round(l.count * 0.42) }))
        : LAYERS,
    []
  )

  return (
    <group>
      {layers.map((layer, i) => (
        <StarLayer key={i} layer={layer} seed={7717 + i * 991} layersRef={layersRef} />
      ))}
    </group>
  )
}
