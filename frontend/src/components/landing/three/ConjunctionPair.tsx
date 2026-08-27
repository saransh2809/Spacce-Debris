import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { scene } from '../lib/sceneStore'
import type { LayerState } from '../lib/sceneStore'
import { placeLabel } from '../lib/labelBridge'
import { encounter } from '../data/landingContent'
import {
  buildTrackRibbon,
  dirA,
  dirB,
  missOffset,
  positionA,
  positionB,
  tcaMidpoint,
} from '../lib/encounterGeometry'

/* ============================================================================
   THE FEATURED CONJUNCTION (spec 14 + 15)
   Two objects on crossing tracks, their paths, the TCA marker, and the live
   separation connector. Playback is driven by scene.encounter, which the
   section's PLAY ENCOUNTER control writes to.

   IMPORTANT — uniforms are updated through the material REF, never by mutating
   the object handed to the `uniforms` prop. React Three Fiber clones that
   object when it applies it, so the rendered material holds a different one and
   writing to the original animates nothing at all.
   ========================================================================== */

const COLOR_A = new THREE.Color('#22D3EE')
const COLOR_B = new THREE.Color('#F97316')

/* ---------------------------------------------------------------- tracks   */

const trackVert = /* glsl */ `
  attribute float aT;         // seconds relative to TCA
  varying float vT;
  void main() {
    vT = aT;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const trackFrag = /* glsl */ `
  uniform vec3  uColor;
  uniform float uOpacity;
  uniform float uHead;        // current playhead, in seconds
  uniform float uPlaying;
  varying float vT;

  void main() {
    // Trail behind the object is solid; the path ahead is a dashed prediction,
    // which is also what keeps the two arcs readable where they cross.
    float behind = step(vT, uHead);
    float dash   = mix(step(0.42, fract(vT * 0.22)), 1.0, behind);
    float base   = mix(0.42, 1.0, behind) * dash;

    // A travelling highlight sits on the playhead. Squared explicitly: GLSL
    // leaves pow() undefined for a negative base, which this one is across the
    // whole trailing half of the track.
    float d0   = (vT - uHead) * 0.11;
    float glow = exp(-(d0 * d0)) * uPlaying;

    float a = (base + glow * 0.9) * uOpacity;
    gl_FragColor = vec4(uColor * (1.0 + glow * 0.8), a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

function useTrack(dir: THREE.Vector3, offset: THREE.Vector3 | null) {
  return useMemo(() => {
    const { positions, params, indices } = buildTrackRibbon(dir, offset)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('aT', new THREE.BufferAttribute(params, 1))
    geo.setIndex(new THREE.BufferAttribute(indices, 1))
    return geo
  }, [dir, offset])
}

/* ------------------------------------------------------------- object dots */

const dotVert = /* glsl */ `
  attribute vec3  aColor;
  attribute float aSize;
  uniform float uPixelRatio;
  uniform float uPulse;
  varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    // Tuned against the conjunction camera distance: these two markers are the
    // subject of the section, so they sit larger than catalogue points.
    gl_PointSize = aSize * uPixelRatio * uPulse * (4.0 / max(0.2, -mv.z));
    vColor = aColor;
  }
`

const dotFrag = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    float core = pow(smoothstep(0.30, 0.0, d), 1.2);
    float halo = pow(smoothstep(0.5, 0.05, d), 2.6);
    gl_FragColor = vec4(vColor + core * 0.55, (core + halo * 0.5) * uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

/* ------------------------------------------------------------------ export */

export function ConjunctionPair({ layersRef }: { layersRef: React.RefObject<LayerState> }) {
  const { camera, size } = useThree()

  const trackA = useTrack(dirA, null)
  const trackB = useTrack(dirB, missOffset)

  const matARef = useRef<any>(null)
  const matBRef = useRef<any>(null)
  const dotMatRef = useRef<any>(null)
  const linkMatRef = useRef<any>(null)
  const ringRef = useRef<any>(null)
  const ringMatRef = useRef<any>(null)

  /* Initial uniform values only — the live copies live on the materials. */
  const initA = useMemo(
    () => ({
      uColor: { value: COLOR_A.clone() },
      uOpacity: { value: 0 },
      uHead: { value: encounter.startSeconds },
      uPlaying: { value: 0 },
    }),
    []
  )
  const initB = useMemo(
    () => ({
      uColor: { value: COLOR_B.clone() },
      uOpacity: { value: 0 },
      uHead: { value: encounter.startSeconds },
      uPlaying: { value: 0 },
    }),
    []
  )

  /* two moving object markers in a single Points object */
  const dotGeometry = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3))
    geo.setAttribute(
      'aColor',
      new THREE.BufferAttribute(
        new Float32Array([COLOR_A.r, COLOR_A.g, COLOR_A.b, COLOR_B.r, COLOR_B.g, COLOR_B.b]),
        3
      )
    )
    geo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array([9.5, 8.5]), 1))
    geo.boundingSphere = new THREE.Sphere(tcaMidpoint.clone(), 3)
    return geo
  }, [])

  const dotInit = useMemo(
    () => ({
      uOpacity: { value: 0 },
      uPulse: { value: 1 },
      uPixelRatio: {
        value: Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio : 1),
      },
    }),
    []
  )

  /* live separation connector */
  const linkGeometry = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3))
    geo.boundingSphere = new THREE.Sphere(tcaMidpoint.clone(), 3)
    return geo
  }, [])

  const posA = useMemo(() => new THREE.Vector3(), [])
  const posB = useMemo(() => new THREE.Vector3(), [])
  const proj = useMemo(() => new THREE.Vector3(), [])

  useFrame(() => {
    const vis = layersRef.current.pair
    const enc = scene.encounter

    /* ---- advance playback from wall clock, not accumulated deltas ---- */
    if (enc.playing) {
      const span = encounter.endSeconds - encounter.startSeconds
      const rate = span / encounter.playbackSeconds
      const now = performance.now()
      if (enc.playStartedAt == null) {
        enc.playStartedAt = now
        enc.playFrom = enc.t
      }
      enc.t = enc.playFrom + ((now - enc.playStartedAt) / 1000) * rate
      if (enc.t >= encounter.endSeconds) {
        enc.t = encounter.endSeconds
        enc.playing = false
        enc.playStartedAt = null
      }
    } else if (enc.playStartedAt != null) {
      enc.playStartedAt = null
    }

    const head = enc.t

    /* ---- positions ---- */
    positionA(head, posA)
    positionB(head, posB)

    const dp = dotGeometry.attributes.position
    dp.array.set([posA.x, posA.y, posA.z, posB.x, posB.y, posB.z])
    dp.needsUpdate = true

    const lp = linkGeometry.attributes.position
    lp.array.set([posA.x, posA.y, posA.z, posB.x, posB.y, posB.z])
    lp.needsUpdate = true

    /* ---- fades, written through the live materials ---- */
    const playing = enc.playing || enc.everPlayed ? 1 : 0
    for (const ref of [matARef, matBRef]) {
      const u = ref.current?.uniforms
      if (!u) continue
      u.uOpacity.value += (vis - u.uOpacity.value) * 0.1
      u.uHead.value = head
      u.uPlaying.value = playing
    }

    // The marker swells as the objects converge — keyed off |t| so it peaks
    // exactly at TCA.
    const closeness = 1 - Math.min(1, Math.abs(head) / encounter.endSeconds)

    const du = dotMatRef.current?.uniforms
    if (du) {
      du.uOpacity.value += (vis - du.uOpacity.value) * 0.1
      du.uPulse.value = 1 + closeness * closeness * 0.45
    }

    if (linkMatRef.current) {
      const linkVis = vis * (0.3 + 0.7 * closeness) * (enc.everPlayed || enc.playing ? 1 : 0.45)
      linkMatRef.current.opacity += (linkVis * 0.85 - linkMatRef.current.opacity) * 0.1
    }

    if (ringMatRef.current) {
      ringMatRef.current.opacity += (vis * 0.9 - ringMatRef.current.opacity) * 0.08
    }
    if (ringRef.current) {
      ringRef.current.quaternion.copy(camera.quaternion) // always face the camera
      const s = 1 + (scene.reducedMotion ? 0 : Math.sin(performance.now() * 0.0018) * 0.06)
      ringRef.current.scale.setScalar(s)
    }

    /* ---- project the in-scene labels ---- */
    // Labels only earn their place while this pair is the subject; fading them
    // with `vis` alone left them legible over neighbouring sections.
    const half = { x: size.width / 2, y: size.height / 2 }
    const labelVis = Math.max(0, (vis - 0.55) / 0.45)
    const toScreen = (v3: THREE.Vector3, key: string, extraX: number, extraY: number) => {
      proj.copy(v3).project(camera)
      const behind = proj.z > 1
      placeLabel(
        key,
        proj.x * half.x + half.x + (extraX || 0),
        -proj.y * half.y + half.y + (extraY || 0),
        behind ? 0 : labelVis
      )
    }
    // At TCA the two objects are only tens of pixels apart, so the labels go to
    // opposite sides rather than stacking — stacked, they collided.
    toScreen(posA, 'objectA', -96, -34)
    toScreen(posB, 'objectB', 96, 34)
    toScreen(tcaMidpoint, 'tca', 0, -78)
  })

  return (
    <group>
      <mesh geometry={trackA} frustumCulled={false} renderOrder={4}>
        <shaderMaterial
          ref={matARef}
          vertexShader={trackVert}
          fragmentShader={trackFrag}
          uniforms={initA}
          transparent
          side={THREE.DoubleSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      <mesh geometry={trackB} frustumCulled={false} renderOrder={4}>
        <shaderMaterial
          ref={matBRef}
          vertexShader={trackVert}
          fragmentShader={trackFrag}
          uniforms={initB}
          transparent
          side={THREE.DoubleSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {/* live separation connector */}
      <lineSegments geometry={linkGeometry} frustumCulled={false} renderOrder={5}>
        <lineBasicMaterial
          ref={linkMatRef}
          color="#F8FAFC"
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </lineSegments>

      {/* TCA marker */}
      <mesh ref={ringRef} position={tcaMidpoint} renderOrder={5}>
        <ringGeometry args={[0.034, 0.04, 48]} />
        <meshBasicMaterial
          ref={ringMatRef}
          color="#EF4444"
          transparent
          opacity={0}
          side={THREE.DoubleSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      <points geometry={dotGeometry} frustumCulled={false} renderOrder={6}>
        <shaderMaterial
          ref={dotMatRef}
          vertexShader={dotVert}
          fragmentShader={dotFrag}
          uniforms={dotInit}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </group>
  )
}
