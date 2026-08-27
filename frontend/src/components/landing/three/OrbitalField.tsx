import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { scene } from '../lib/sceneStore'
import type { LayerState } from '../lib/sceneStore'
import { orbitalPopulation } from '../data/landingContent'

/* ============================================================================
   ORBITAL ENVIRONMENT (spec 10)
   Every object is a point in ONE BufferGeometry. Its orbit is stored as four
   floats and evaluated in the vertex shader from a single time uniform, so the
   whole population animates in one draw call with zero per-frame CPU work.
   This is a stylised population, not the KAKSHA catalogue.
   ========================================================================== */

const COUNT_DESKTOP = 2200
const COUNT_MOBILE = 520

/** Orbital regimes as [radiusMin, radiusMax, inclinationSpreadRad, share]. */
const REGIMES = [
  { r: [1.075, 1.16], incSpread: 1.75, share: 0.56 }, // dense LEO
  { r: [1.16, 1.3], incSpread: 1.5, share: 0.24 },    // upper LEO
  { r: [1.34, 1.52], incSpread: 0.95, share: 0.12 },  // MEO-ish
  { r: [1.55, 1.72], incSpread: 0.28, share: 0.08 },  // near-equatorial belt
]

const vert = /* glsl */ `
  attribute vec4  aOrbit;   // x: radius, y: inclination, z: RAAN, w: phase
  attribute float aRate;
  attribute float aSize;
  attribute vec3  aColor;
  attribute float aFlag;    // 1.0 = highlighted / high-interest object

  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uHighlight;

  varying vec3  vColor;
  varying float vFlag;
  varying float vAtten;

  void main() {
    float r    = aOrbit.x;
    float inc  = aOrbit.y;
    float raan = aOrbit.z;
    float th   = aOrbit.w + uTime * aRate;

    // In-plane circular position, then inclination about X, then RAAN about Y.
    vec3 p = vec3(cos(th) * r, 0.0, sin(th) * r);

    float ci = cos(inc), si = sin(inc);
    p = vec3(p.x, p.y * ci - p.z * si, p.y * si + p.z * ci);

    float cr = cos(raan), sr = sin(raan);
    p = vec3(p.x * cr + p.z * sr, p.y, -p.x * sr + p.z * cr);

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;

    float pulse = 1.0 + aFlag * uHighlight * 0.55 * sin(uTime * 2.2 + aOrbit.w);
    float size = aSize * uPixelRatio * pulse * (11.0 / max(0.35, -mv.z));

    // Same trick as the starfield: clamp tiny points up to one pixel but pay
    // the difference back in alpha, so distant objects stay faint instead of
    // all snapping to the same brightness.
    float clamped = max(size, 1.0);
    vAtten = size / clamped;
    gl_PointSize = clamped;

    vColor = aColor;
    vFlag  = aFlag;
  }
`

const frag = /* glsl */ `
  uniform float uOpacity;
  uniform float uHighlight;

  varying vec3  vColor;
  varying float vFlag;
  varying float vAtten;

  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;

    float core = pow(smoothstep(0.5, 0.02, d), 1.5);
    float halo = pow(smoothstep(0.5, 0.18, d), 3.0);
    float a = core * 0.85 + halo * 0.35;

    vec3 col = vColor + vFlag * uHighlight * vec3(0.30, 0.10, 0.0);
    gl_FragColor = vec4(col, a * uOpacity * vAtten * (0.8 + 0.2 * vFlag));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pickRegime(rand: () => number) {
  let roll = rand()
  for (const reg of REGIMES) {
    if (roll < reg.share) return reg
    roll -= reg.share
  }
  return REGIMES[0]
}

function pickType(rand: () => number) {
  let roll = rand()
  for (const type of orbitalPopulation) {
    if (roll < type.share) return type
    roll -= type.share
  }
  return orbitalPopulation[0]
}

function buildField(count: number, seed: number) {
  const rand = rng(seed)
  const positions = new Float32Array(count * 3) // placeholder; real position is computed on the GPU
  const orbit = new Float32Array(count * 4)
  const rate = new Float32Array(count)
  const size = new Float32Array(count)
  const color = new Float32Array(count * 3)
  const flag = new Float32Array(count)

  const c = new THREE.Color()

  for (let i = 0; i < count; i++) {
    const regime = pickRegime(rand)
    const type = pickType(rand)

    const r = regime.r[0] + rand() * (regime.r[1] - regime.r[0])
    const inc = (rand() - 0.5) * 2 * regime.incSpread
    const raan = rand() * Math.PI * 2
    const phase = rand() * Math.PI * 2

    orbit[i * 4] = r
    orbit[i * 4 + 1] = inc
    orbit[i * 4 + 2] = raan
    orbit[i * 4 + 3] = phase

    // Keplerian-shaped rate: inner orbits visibly outrun outer ones.
    rate[i] = 0.30 / Math.pow(r, 1.5)

    c.set(type.color)
    color[i * 3] = c.r
    color[i * 3 + 1] = c.g
    color[i * 3 + 2] = c.b

    size[i] = type.id === 'station' ? 4.2 : type.id === 'debris' ? 1.5 : 2.1
    size[i] *= 0.7 + rand() * 0.7

    // A small set of highlighted / high-interest objects (spec 10).
    flag[i] = rand() > 0.986 ? 1 : 0
    if (flag[i]) {
      size[i] *= 1.9
      c.set('#F97316')
      color[i * 3] = c.r
      color[i * 3 + 1] = c.g
      color[i * 3 + 2] = c.b
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('aOrbit', new THREE.BufferAttribute(orbit, 4))
  geo.setAttribute('aRate', new THREE.BufferAttribute(rate, 1))
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
  geo.setAttribute('aColor', new THREE.BufferAttribute(color, 3))
  geo.setAttribute('aFlag', new THREE.BufferAttribute(flag, 1))
  // Positions are generated in the shader, so the CPU-side bounds are meaningless.
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2)
  return geo
}

/* ---------------------------------------------------------- orbit path rings */

/**
 * All rings merged into ONE LineSegments. Note this deliberately avoids the
 * `<line>` JSX intrinsic, which collides with the SVG line element in React —
 * lineSegments has no such ambiguity.
 */
function buildRings(seed: number, count: number) {
  const rand = rng(seed)
  const SEG = 132
  const verts = []
  const cols = []
  const c = new THREE.Color()

  for (let k = 0; k < count; k++) {
    const regime = pickRegime(rand)
    const r = regime.r[0] + rand() * (regime.r[1] - regime.r[0])
    const inc = (rand() - 0.5) * 2 * regime.incSpread
    const raan = rand() * Math.PI * 2

    const type = pickType(rand)
    c.set(type.color)
    const fade = 0.16 + rand() * 0.24

    const pts = []
    for (let i = 0; i <= SEG; i++) {
      const th = (i / SEG) * Math.PI * 2
      let x = Math.cos(th) * r
      let y = 0
      let z = Math.sin(th) * r
      const ci = Math.cos(inc)
      const si = Math.sin(inc)
      const y2 = y * ci - z * si
      const z2 = y * si + z * ci
      const cr = Math.cos(raan)
      const sr = Math.sin(raan)
      pts.push(new THREE.Vector3(x * cr + z2 * sr, y2, -x * sr + z2 * cr))
    }

    for (let i = 0; i < SEG; i++) {
      const a = pts[i]
      const b = pts[i + 1]
      verts.push(a.x, a.y, a.z, b.x, b.y, b.z)
      // Fade each ring along its own length so it reads as a path, not a wire.
      const fa = fade * (0.25 + 0.75 * Math.abs(Math.sin((i / SEG) * Math.PI)))
      const fb = fade * (0.25 + 0.75 * Math.abs(Math.sin(((i + 1) / SEG) * Math.PI)))
      cols.push(c.r * fa, c.g * fa, c.b * fa, c.r * fb, c.g * fb, c.b * fb)
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3))
  return geo
}

/* ------------------------------------------------------------------ export */

export function OrbitalField({ layersRef }: { layersRef: React.RefObject<LayerState> }) {
  const pointsRef = useRef<any>(null)
  const ringsRef = useRef<any>(null)
  const ringMatRef = useRef<any>(null)

  const count = scene.isMobile ? COUNT_MOBILE : COUNT_DESKTOP
  const ringCount = scene.isMobile ? 9 : 30

  const geometry = useMemo(() => buildField(count, 4242), [count])
  const ringGeometry = useMemo(() => buildRings(881, ringCount), [ringCount])

  const matRef = useRef<any>(null)

  /* Initial values only; the live uniforms are reached through matRef. */
  const init = useMemo(
    () => ({
      uTime: { value: 0 },
      uOpacity: { value: 0 },
      uHighlight: { value: 1 },
      uPixelRatio: { value: Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio : 1) },
    }),
    []
  )

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    const layers = layersRef.current
    const u = matRef.current?.uniforms
    if (u) {
      u.uTime.value += scene.reducedMotion ? dt * 0.25 : dt
      u.uOpacity.value += (layers.orbit - u.uOpacity.value) * 0.07
      u.uHighlight.value = scene.reducedMotion ? 0.2 : 1
    }

    if (ringMatRef.current) {
      ringMatRef.current.opacity += (layers.rings * 0.8 - ringMatRef.current.opacity) * 0.07
    }
    // Rings precess almost imperceptibly, which keeps the shell from looking static.
    if (ringsRef.current && !scene.reducedMotion) {
      ringsRef.current.rotation.y += 0.004 * dt
    }
  })

  return (
    <group>
      <lineSegments ref={ringsRef} geometry={ringGeometry} renderOrder={1}>
        <lineBasicMaterial
          ref={ringMatRef}
          vertexColors
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </lineSegments>

      <points ref={pointsRef} geometry={geometry} frustumCulled={false} renderOrder={3}>
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
    </group>
  )
}
