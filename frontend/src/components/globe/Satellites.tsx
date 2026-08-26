/**
 * KAKSHA -- the object field.
 *
 * Eighteen thousand objects cannot be eighteen thousand meshes. Each one would
 * carry its own draw call, its own matrix and its own raycast test, and the
 * scene would run at single-digit frame rates on the machine it is being
 * demonstrated on.
 *
 * Instead the catalogue is split into four THREE.Points layers -- satellites,
 * stations, rocket bodies, debris -- one draw call each, with a class-specific
 * sprite. Four draw calls for the whole catalogue.
 *
 * WHY SPLIT BY CLASS RATHER THAN ONE LAYER
 * ----------------------------------------
 * A single point cloud can only carry one sprite, so every object had to be
 * the same round dot and the only thing distinguishing a live satellite from a
 * debris fragment was hue. At the densities in LEO that is not enough -- the
 * classes visually merge. Splitting by class buys a distinct silhouette per
 * class at the cost of three extra draw calls, which is nothing.
 *
 * WHY NORMAL BLENDING, NOT ADDITIVE
 * ---------------------------------
 * Additive blending sums overlapping sprites toward white, so dense regions
 * bloom into a featureless mass -- exactly the congestion this view is meant to
 * show structure in. Normal blending keeps a thousand overlapping debris chips
 * looking like a thousand chips.
 *
 * The positions come from the backend already propagated. This component does
 * no orbital mechanics whatsoever -- it copies numbers into a buffer.
 */
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { KM_PER_UNIT } from "./Earth";
import { getSprites } from "./sprites";
import type { SceneResponse } from "../../api/types";

/**
 * Colours by object class, indexed by the backend's `type_code`.
 * Order must match `type_order` in the scene payload.
 */
const TYPE_COLORS = [
  new THREE.Color("#2dd4bf"), // ACTIVE_SATELLITE
  new THREE.Color("#6b8fa8"), // INACTIVE_SATELLITE
  new THREE.Color("#8792a3"), // DEBRIS
  new THREE.Color("#e8913c"), // ROCKET_BODY
  new THREE.Color("#8be9fd"), // SPACE_STATION
  new THREE.Color("#5a6478"), // UNKNOWN
];
const INDIA_COLOR = new THREE.Color("#f5a623");
const HIGHLIGHT_COLOR = new THREE.Color("#f04747");
const SELECTED_COLOR = new THREE.Color("#ffffff");

/** Which sprite layer each type_code belongs to. */
const LAYER_OF_TYPE = [0, 0, 3, 2, 1, 3] as const;

interface LayerSpec {
  key: string;
  sprite: keyof ReturnType<typeof getSprites>;
  /** Base sprite footprint, in the same units as `baseSize` below. */
  size: number;
  opacity: number;
  /** Sprite brightness multiplier, before the per-point colour is applied. */
  gain: number;
}

/**
 * Per-layer presentation.
 *
 * Debris is deliberately the smallest, dimmest and least saturated: it is 90%
 * of the population, so if it is drawn with the same weight as an active
 * satellite it is the only thing you can see. Stations are the largest because
 * there are thirteen of them and they are landmarks.
 */
const LAYERS: LayerSpec[] = [
  { key: "satellites", sprite: "satellite", size: 3.5, opacity: 1.0, gain: 1.0 },
  { key: "stations", sprite: "station", size: 6.2, opacity: 1.0, gain: 1.15 },
  { key: "rockets", sprite: "rocket", size: 2.9, opacity: 0.92, gain: 0.95 },
  { key: "debris", sprite: "debris", size: 1.5, opacity: 0.6, gain: 0.8 },
];

const POINT_VERT = /* glsl */ `
attribute float size;
attribute vec3 color;
varying vec3 vColor;
varying float vFade;
uniform float pixelRatio;
uniform float baseSize;
uniform float minPixels;

void main() {
  vColor = color;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

  // Perspective-correct sizing with a floor, so a distant object stays visible
  // as a mark rather than vanishing entirely.
  float dist = -mvPosition.z;
  gl_PointSize = max(minPixels * pixelRatio, baseSize * size * pixelRatio * (9.0 / max(dist, 0.6)));

  // Fade with range so the far hemisphere reads as further away instead of
  // competing with the near one for attention.
  vFade = clamp(1.0 - (dist - 10.0) / 55.0, 0.30, 1.0);

  gl_Position = projectionMatrix * mvPosition;
}
`;

const POINT_FRAG = /* glsl */ `
uniform sampler2D map;
uniform float opacity;
uniform float gain;
varying vec3 vColor;
varying float vFade;

void main() {
  vec4 tex = texture2D(map, gl_PointCoord);
  if (tex.a < 0.02) discard;

  // The sprite is a luminance mask: its red channel carries internal shading,
  // its alpha carries the silhouette. Colour comes entirely from the vertex.
  vec3 c = vColor * (0.45 + 0.85 * tex.r) * gain;
  gl_FragColor = vec4(c, tex.a * opacity * vFade);
}
`;

/**
 * Points raycast with a screen-scaled threshold.
 *
 * The default threshold is a fixed world distance, which makes far objects
 * effectively unhoverable and near ones grabby. Scaling it with camera
 * distance keeps the hit target roughly constant in screen pixels.
 */
const pointsRaycast: THREE.Object3D["raycast"] = function (
  this: THREE.Points,
  raycaster,
  intersects,
) {
  const camera = raycaster.camera;
  if (camera) {
    const distance = camera.position.length();
    raycaster.params.Points = { threshold: Math.max(0.010, distance * 0.0055) };
  }
  THREE.Points.prototype.raycast.call(this, raycaster, intersects);
};

interface PointLayerProps {
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  norads: Int32Array;
  texture: THREE.Texture;
  baseSize: number;
  minPixels: number;
  opacity: number;
  gain: number;
  onHover?: (noradId: number | null) => void;
  onSelect?: (noradId: number) => void;
}

function PointLayer({
  positions,
  colors,
  sizes,
  norads,
  texture,
  baseSize,
  minPixels,
  opacity,
  gain,
  onHover,
  onSelect,
}: PointLayerProps) {
  const { gl } = useThree();
  const hoverIndex = useRef(-1);
  const geometry = useMemo(() => new THREE.BufferGeometry(), []);

  const uniforms = useMemo(
    () => ({
      map: { value: texture },
      pixelRatio: { value: Math.min(gl.getPixelRatio(), 2) },
      baseSize: { value: baseSize },
      minPixels: { value: minPixels },
      opacity: { value: opacity },
      gain: { value: gain },
    }),
    // Values are pushed imperatively below; this builds the object once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [texture],
  );

  useEffect(() => {
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
    geometry.computeBoundingSphere();
  }, [geometry, positions, colors, sizes]);

  useFrame(() => {
    uniforms.pixelRatio.value = Math.min(gl.getPixelRatio(), 2);
    uniforms.baseSize.value = baseSize;
    uniforms.minPixels.value = minPixels;
    uniforms.opacity.value = opacity;
    uniforms.gain.value = gain;
  });

  if (norads.length === 0) return null;

  return (
    <points
      geometry={geometry}
      raycast={pointsRaycast}
      onPointerMove={(e: ThreeEvent<PointerEvent>) => {
        const i = e.index ?? -1;
        if (i === hoverIndex.current) return;
        hoverIndex.current = i;
        onHover?.(i >= 0 && i < norads.length ? norads[i] : null);
      }}
      onPointerOut={() => {
        hoverIndex.current = -1;
        onHover?.(null);
      }}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        const i = e.index ?? -1;
        if (i < 0 || i >= norads.length) return;
        e.stopPropagation();
        onSelect?.(norads[i]);
      }}
    >
      <shaderMaterial
        vertexShader={POINT_VERT}
        fragmentShader={POINT_FRAG}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.NormalBlending}
      />
    </points>
  );
}

interface SatellitesProps {
  scene: SceneResponse | undefined;
  /** NORAD IDs to draw in the highlight colour (conjunction participants). */
  highlighted?: Set<number>;
  selectedNorad?: number | null;
  /** Tint Indian assets amber, matching the catalogue rail. */
  emphasiseIndia?: boolean;
  onHover?: (noradId: number | null) => void;
  onSelect?: (noradId: number) => void;
  sizeScale?: number;
  /** DENSITY view: abstract every class to a plain dot. */
  abstract?: boolean;
}

export function Satellites({
  scene,
  highlighted,
  selectedNorad,
  emphasiseIndia = true,
  onHover,
  onSelect,
  sizeScale = 1,
  abstract = false,
}: SatellitesProps) {
  const sprites = getSprites();

  /**
   * Partition the catalogue into per-class typed-array buffers.
   *
   * COUNT, ALLOCATE, FILL -- in that order, deliberately.
   *
   * This previously pushed into plain JS arrays and then copied each one into a
   * Float32Array, which is two passes over the catalogue plus a large amount of
   * short-lived garbage on every payload. On a time jump that showed up as a
   * ~150 ms main-thread block, measured with PerformanceObserver longtask
   * entries. Counting first lets every buffer be allocated at its exact final
   * size and written once, with no intermediate arrays and nothing for the
   * collector to clean up.
   *
   * Recomputed only when the payload or the emphasis changes -- never per frame.
   */
  const typed = useMemo(() => {
    const n = scene?.count ?? 0;
    const counts = new Int32Array(LAYERS.length);

    if (scene && n > 0) {
      for (let i = 0; i < n; i++) {
        counts[LAYER_OF_TYPE[scene.type_codes[i] ?? 5] ?? 3]++;
      }
    }

    const buffers = LAYERS.map((_, layer) => ({
      positions: new Float32Array(counts[layer] * 3),
      colors: new Float32Array(counts[layer] * 3),
      sizes: new Float32Array(counts[layer]),
      norads: new Int32Array(counts[layer]),
    }));

    if (!scene || n === 0) return buffers;

    const cursor = new Int32Array(LAYERS.length);
    const src = scene.positions_km;

    for (let i = 0; i < n; i++) {
      const typeCode = scene.type_codes[i] ?? 5;
      const norad = scene.norad_ids[i];
      const layer = LAYER_OF_TYPE[typeCode] ?? 3;
      const b = buffers[layer];
      const k = cursor[layer]++;

      // TEME (x, y, z) -> scene (x, z, -y). Same relabelling as Earth.tsx.
      b.positions[k * 3] = src[i * 3] / KM_PER_UNIT;
      b.positions[k * 3 + 1] = src[i * 3 + 2] / KM_PER_UNIT;
      b.positions[k * 3 + 2] = -src[i * 3 + 1] / KM_PER_UNIT;

      let color = TYPE_COLORS[typeCode] ?? TYPE_COLORS[5];
      let size = 1;

      if (highlighted?.has(norad)) {
        color = HIGHLIGHT_COLOR;
        size = 2.4;
      } else if (norad === selectedNorad) {
        color = SELECTED_COLOR;
        size = 2.2;
      } else if (emphasiseIndia && scene.country_iso[i] === "IN") {
        color = INDIA_COLOR;
        size = 1.35;
      }

      b.colors[k * 3] = color.r;
      b.colors[k * 3 + 1] = color.g;
      b.colors[k * 3 + 2] = color.b;
      b.sizes[k] = size;
      b.norads[k] = norad;
    }

    return buffers;
  }, [scene, highlighted, selectedNorad, emphasiseIndia]);

  if (!scene || scene.count === 0) return null;

  return (
    <group>
      {LAYERS.map((spec, index) => {
        const buffers = typed[index];
        if (buffers.norads.length === 0) return null;
        return (
          <PointLayer
            key={spec.key}
            positions={buffers.positions}
            colors={buffers.colors}
            sizes={buffers.sizes}
            norads={buffers.norads}
            texture={abstract ? sprites.dot : sprites[spec.sprite]}
            baseSize={spec.size * sizeScale * (abstract ? 0.55 : 1)}
            // Sprites need a few pixels before the silhouette resolves; a
            // debris chip may legitimately shrink to a single pixel.
            minPixels={abstract ? 1.2 : spec.key === "debris" ? 1.6 : 5.0}
            opacity={spec.opacity}
            gain={spec.gain}
            onHover={onHover}
            onSelect={onSelect}
          />
        );
      })}
    </group>
  );
}

/**
 * A single emphasised object: the selected satellite or a conjunction
 * participant. Drawn as real geometry so it reads clearly against the point
 * field and can carry a selection ring.
 */
export function ObjectMarker({
  positionKm,
  color = "#ffffff",
  ring = true,
  scale = 1,
}: {
  positionKm: [number, number, number] | null;
  color?: string;
  ring?: boolean;
  scale?: number;
}) {
  const ringRef = useRef<THREE.Mesh>(null);
  const { camera } = useThree();

  useFrame(() => {
    if (ringRef.current) ringRef.current.lookAt(camera.position);
  });

  if (!positionKm) return null;
  const p: [number, number, number] = [
    positionKm[0] / KM_PER_UNIT,
    positionKm[2] / KM_PER_UNIT,
    -positionKm[1] / KM_PER_UNIT,
  ];

  return (
    <group position={p}>
      <mesh>
        <sphereGeometry args={[0.012 * scale, 12, 12]} />
        <meshBasicMaterial color={color} />
      </mesh>
      {ring && (
        <mesh ref={ringRef}>
          <ringGeometry args={[0.028 * scale, 0.034 * scale, 40]} />
          <meshBasicMaterial
            color={color}
            side={THREE.DoubleSide}
            transparent
            opacity={0.85}
          />
        </mesh>
      )}
    </group>
  );
}
