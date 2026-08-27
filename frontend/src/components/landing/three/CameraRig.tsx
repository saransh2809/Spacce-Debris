import { useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { sampleCamera, sampleLayers, scene, update as updateScene } from '../lib/sceneStore'
import type { CameraKey, CameraState, LayerState } from '../lib/sceneStore'

/* ============================================================================
   CAMERA RIG
   Turns the scroll position into one continuous camera move. The rig reads the
   scene director directly each frame — scrolling never re-renders React.

   Framing is resolved in SCREEN space: a keyframe says "put the subject a third
   of the way right of centre", and the rig converts that to a world-space pan
   using the live fov and aspect. That is what keeps the composition intact from
   an ultrawide monitor down to a phone.
   ========================================================================== */

const damp = (current: number, target: number, lambda: number, dt: number) =>
  current + (target - current) * (1 - Math.exp(-lambda * dt))

/** Keys interpolated each frame. Listed explicitly so indexing stays typed. */
const CAMERA_KEYS: CameraKey[] = [
  'lookX', 'lookY', 'lookZ', 'dist', 'yaw', 'pitch', 'subjectX', 'subjectY', 'roll',
]

export function CameraRig({ layersRef }: { layersRef: React.RefObject<LayerState> }) {
  const { camera, size } = useThree()

  const state = useMemo(
    () => ({
      cam: {
        lookX: 0, lookY: 0, lookZ: 0,
        dist: 4.15, yaw: 0.34, pitch: 0.12,
        subjectX: 0.33, subjectY: -0.02, roll: 0,
      } as CameraState,
      smooth: {
        lookX: 0, lookY: 0, lookZ: 0,
        dist: 4.15, yaw: 0.34, pitch: 0.12,
        subjectX: 0.33, subjectY: -0.02, roll: 0,
      } as CameraState,
      base: new THREE.Vector3(),
      look: new THREE.Vector3(),
      right: new THREE.Vector3(),
      up: new THREE.Vector3(),
      pan: new THREE.Vector3(),
      first: true,
    }),
    []
  )

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    updateScene()

    const cam = sampleCamera(scene.stage, state.cam)
    sampleLayers(scene.stage, layersRef.current)

    const s = state.smooth
    // On the very first frame snap, so the opening shot is never a fly-in.
    const lambda = state.first ? 1e6 : scene.reducedMotion ? 26 : 7.5
    for (const k of CAMERA_KEYS) {
      s[k] = damp(s[k], cam[k], lambda, dt)
    }
    state.first = false

    /* ---- pointer parallax: small, and off entirely under reduced motion ---- */
    const p = scene.pointer
    const pt = scene.pointerTarget
    p.x = damp(p.x, scene.reducedMotion ? 0 : pt.x, 3.2, dt)
    p.y = damp(p.y, scene.reducedMotion ? 0 : pt.y, 3.2, dt)

    const yaw = s.yaw + p.x * 0.03
    const pitch = s.pitch - p.y * 0.02

    /* ---- responsive framing ---- */
    const aspect = size.width / Math.max(1, size.height)
    // Narrow viewports see less horizontally at the same fov, so back off to
    // keep the subject fully in frame rather than cropping it.
    const distMul = THREE.MathUtils.clamp(1 + (1.62 - aspect) * 0.44, 1, 1.95)
    const dist = s.dist * distMul

    // A single-column mobile layout has no side gutter to protect, so the
    // subject drifts back toward centre.
    const lateral = scene.isMobile ? 0.22 : 1
    const subjectX = s.subjectX * lateral
    const subjectY = scene.isMobile ? s.subjectY * 0.82 : s.subjectY

    /* ---- place the camera on its orbit around `look` ---- */
    const cp = Math.cos(pitch)
    state.look.set(s.lookX, s.lookY, s.lookZ)
    state.base.set(
      state.look.x + dist * cp * Math.sin(yaw),
      state.look.y + dist * Math.sin(pitch),
      state.look.z + dist * cp * Math.cos(yaw)
    )

    camera.position.copy(state.base)
    camera.up.set(0, 1, 0)
    camera.lookAt(state.look)
    camera.updateMatrixWorld()

    /* ---- convert the screen-space framing request into a world pan ---- */
    // The stage always mounts a perspective camera; R3F types the hook's
    // `camera` as the base class, which has neither fov nor aspect.
    const persp = camera as THREE.PerspectiveCamera
    const vHalf = THREE.MathUtils.degToRad(persp.fov) / 2
    const hHalf = Math.atan(Math.tan(vHalf) * persp.aspect)
    const panX = -subjectX * Math.tan(hHalf) * dist
    const panY = -subjectY * Math.tan(vHalf) * dist

    state.right.setFromMatrixColumn(camera.matrixWorld, 0)
    state.up.setFromMatrixColumn(camera.matrixWorld, 1)
    state.pan.copy(state.right).multiplyScalar(panX).addScaledVector(state.up, panY)

    camera.position.copy(state.base).add(state.pan)
    state.look.add(state.pan)
    camera.lookAt(state.look)

    if (s.roll !== 0) camera.rotateZ(s.roll)
    camera.updateMatrixWorld()
  })

  return null
}
