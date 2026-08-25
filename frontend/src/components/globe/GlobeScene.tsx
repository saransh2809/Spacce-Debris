/**
 * KAKSHA -- the 3D viewport.
 *
 * Composes Earth, star field, the object point cloud, orbit paths and
 * conjunction markers, and wires camera behaviour (focus-on-object,
 * focus-on-encounter) to the selection in the store.
 *
 * Nothing here computes physics. Every position, every orbit vertex and every
 * encounter point is fetched from the backend already propagated.
 */
import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useCallback, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { Earth, KM_PER_UNIT } from "./Earth";
import { ObjectMarker, Satellites } from "./Satellites";
import {
  ConjunctionMarker,
  OrbitPath,
  ReferenceGrid,
  RegimeShells,
  Starfield,
} from "./SceneElements";
import { useStore } from "../../store/useStore";
import {
  useConjunctionDetail,
  useEnvironment,
  useObject,
  useOrbit,
  useScene,
} from "../../hooks/useKaksha";
import type { ConjunctionDetail } from "../../api/types";

/** Smoothly move the camera target and distance toward a requested focus. */
function CameraDirector({
  focusPoint,
  focusDistance,
  active,
  controlsRef,
}: {
  focusPoint: THREE.Vector3 | null;
  focusDistance: number;
  active: boolean;
  controlsRef: React.RefObject<OrbitControlsImpl | null>;
}) {
  const { camera } = useThree();
  const target = useRef(new THREE.Vector3(0, 0, 0));
  const desired = useRef(new THREE.Vector3(0, 0, 0));

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    if (!controls) return;

    if (active && focusPoint) {
      desired.current.copy(focusPoint);
    } else {
      desired.current.set(0, 0, 0);
    }

    // Critically-damped-ish easing; frame-rate independent.
    const k = 1 - Math.pow(0.0016, delta);
    target.current.lerp(desired.current, k);
    controls.target.copy(target.current);

    if (active && focusPoint) {
      const offset = camera.position.clone().sub(controls.target);
      const currentDist = offset.length();
      const newDist = THREE.MathUtils.lerp(currentDist, focusDistance, k * 0.8);
      camera.position.copy(controls.target).add(offset.setLength(newDist));
    }

    controls.update();
  });

  return null;
}

function toScene(p: (number | null)[] | undefined): [number, number, number] | null {
  if (!p || p.length < 3) return null;
  const [x, y, z] = p;
  if (x === null || y === null || z === null) return null;
  return [x, y, z];
}

function sceneVec(p: [number, number, number]): THREE.Vector3 {
  return new THREE.Vector3(p[0] / KM_PER_UNIT, p[2] / KM_PER_UNIT, -p[1] / KM_PER_UNIT);
}

function SceneContents({ detail }: { detail: ConjunctionDetail | undefined }) {
  const layers = useStore((s) => s.layers);
  const viewMode = useStore((s) => s.viewMode);
  const countries = useStore((s) => s.countries);
  const regime = useStore((s) => s.regime);
  const selectedNorad = useStore((s) => s.selectedNorad);
  const selectionMode = useStore((s) => s.selectionMode);
  const followSelected = useStore((s) => s.followSelected);
  const setHoveredNorad = useStore((s) => s.setHoveredNorad);
  const setSelectedNorad = useStore((s) => s.setSelectedNorad);
  const activeObjectTypes = useStore((s) => s.activeObjectTypes);

  const controlsRef = useRef<OrbitControlsImpl | null>(null);

  // Read straight from the store rather than subscribing: this is called every
  // frame and must not trigger React renders.
  const simNowMs = useCallback(() => useStore.getState().simNow().getTime(), []);

  const maxObjects = useStore((s) => s.maxObjects);
  const autoRotate = useStore((s) => s.autoRotate);

  const objectTypes = activeObjectTypes();
  const { data: scene } = useScene({
    objectTypes: objectTypes.length ? objectTypes : ["__none__"],
    countries: countries.length ? countries : undefined,
    regime,
    // DENSITY deliberately overrides the display cap: that mode exists to show
    // the whole population as a field, where congestion IS the information.
    limit: viewMode === "DENSITY" ? 18000 : maxObjects,
    stepMs: 1000,
  });

  const { data: env } = useEnvironment(1000);
  const { data: selected } = useObject(selectedNorad);
  const { data: orbit } = useOrbit(
    layers.orbits && selectedNorad !== null ? selectedNorad : null,
    1,
  );

  // Conjunction participants: their orbits and their positions at TCA.
  const eventA = detail?.object_a.norad_id ?? null;
  const eventB = detail?.object_b.norad_id ?? null;
  const { data: orbitA } = useOrbit(layers.conjunctions ? eventA : null, 1);
  const { data: orbitB } = useOrbit(layers.conjunctions ? eventB : null, 1);

  const highlighted = useMemo(() => {
    const s = new Set<number>();
    if (detail && layers.conjunctions) {
      s.add(detail.object_a.norad_id);
      s.add(detail.object_b.norad_id);
    }
    return s;
  }, [detail, layers.conjunctions]);

  const gmst = env?.gmst_rad ?? 0;
  const sunTeme = (env?.sun_direction_teme ?? [1, 0, 0]) as [number, number, number];

  // Where the camera should look.
  const caPosA = toScene(detail?.closest_approach.state_a.position_km);
  const caPosB = toScene(detail?.closest_approach.state_b.position_km);
  const selectedPos = toScene(selected?.state?.position_km);

  let focusPoint: THREE.Vector3 | null = null;
  let focusDistance = 3.2;
  let focusActive = false;

  if (selectionMode === "CONJUNCTION" && caPosA && caPosB) {
    focusPoint = sceneVec(caPosA).add(sceneVec(caPosB)).multiplyScalar(0.5);
    focusDistance = 0.55;
    focusActive = true;
  } else if (followSelected && selectedPos) {
    focusPoint = sceneVec(selectedPos);
    focusDistance = 0.9;
    focusActive = true;
  }

  return (
    <>
      <Starfield />
      <Earth
        gmst={gmst}
        sunTeme={sunTeme}
        showClouds
        quality="high"
        simNowMs={simNowMs}
      />
      <ReferenceGrid visible={viewMode !== "DENSITY"} />
      <RegimeShells visible={viewMode === "ORBITS"} />

      <Satellites
        scene={scene}
        highlighted={highlighted}
        selectedNorad={selectedNorad}
        emphasiseIndia
        onHover={setHoveredNorad}
        onSelect={(id) => setSelectedNorad(id)}
        sizeScale={viewMode === "DENSITY" ? 0.55 : 1}
        abstract={viewMode === "DENSITY"}
      />

      {layers.orbits && orbit && orbit.vertex_count > 1 && (
        <OrbitPath positionsKm={orbit.positions_km} color="#2dd4bf" opacity={0.62} />
      )}

      {layers.conjunctions && orbitA && orbitA.vertex_count > 1 && (
        <OrbitPath positionsKm={orbitA.positions_km} color="#f0a030" opacity={0.55} />
      )}
      {layers.conjunctions && orbitB && orbitB.vertex_count > 1 && (
        <OrbitPath positionsKm={orbitB.positions_km} color="#f04747" opacity={0.55} />
      )}

      {layers.conjunctions && caPosA && caPosB && (
        <ConjunctionMarker positionAKm={caPosA} positionBKm={caPosB} />
      )}

      {selectedPos && selectionMode !== "CONJUNCTION" && (
        <ObjectMarker positionKm={selectedPos} color="#ffffff" />
      )}

      <OrbitControls
        ref={controlsRef as never}
        enablePan={false}
        enableDamping
        dampingFactor={0.07}
        rotateSpeed={0.42}
        zoomSpeed={0.8}
        minDistance={1.06}
        maxDistance={30}
        // Idle drift. Suspended whenever the camera is under orders -- chasing
        // an encounter or following a selected object -- because fighting the
        // director for control of the camera looks like a bug.
        autoRotate={autoRotate && !focusActive}
        autoRotateSpeed={0.34}
      />
      <CameraDirector
        focusPoint={focusPoint}
        focusDistance={focusDistance}
        active={focusActive}
        controlsRef={controlsRef}
      />
    </>
  );
}

function LoadingFallback() {
  return (
    <mesh>
      <sphereGeometry args={[1, 32, 16]} />
      <meshBasicMaterial color="#0d1b2a" wireframe />
    </mesh>
  );
}

export function GlobeScene() {
  const selectedEventId = useStore((s) => s.selectedEventId);
  const { data: detail } = useConjunctionDetail(selectedEventId);

  return (
    <Canvas
      camera={{ position: [0, 1.4, 3.4], fov: 42, near: 0.01, far: 400 }}
      dpr={[1, 2]}
      gl={{
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
      }}
      onCreated={(state) => {
        const { gl, scene } = state;
        gl.setClearColor(new THREE.Color("#04070e"), 1);
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.34;
        scene.background = new THREE.Color("#04070e");

        // Dev-only handle on the renderer state. Lets the scene graph, draw
        // calls and buffer sizes be inspected from the console without adding
        // any UI, and is stripped from production builds.
        if (import.meta.env.DEV) {
          (window as unknown as { __KAKSHA_R3F?: unknown }).__KAKSHA_R3F = state;
        }
      }}
      style={{ width: "100%", height: "100%", display: "block" }}
    >
      <Suspense fallback={<LoadingFallback />}>
        <SceneContents detail={detail} />
      </Suspense>
    </Canvas>
  );
}
