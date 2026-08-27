/**
 * KAKSHA -- supporting scene elements: starfield, orbit paths, conjunction
 * markers and the equatorial reference grid.
 */
import { extend, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { KM_PER_UNIT } from "./Earth";

/**
 * Register THREE.Line with react-three-fiber under the name `threeLine`.
 *
 * THIS LINE IS WHY THE 3D VIEW WOULD NOT START.
 *
 * R3F resolves a lowercase JSX tag by PascalCasing it and looking the result
 * up in its catalogue, which is seeded from the THREE namespace. `<threeLine>`
 * becomes `ThreeLine`, which is not a THREE export, so R3F threw
 *
 *     R3F: ThreeLine is not part of the THREE namespace! Did you forget to extend?
 *
 * the instant it tried to build the scene graph -- before a single frame was
 * drawn. Every orbit path, the conjunction connector, the reference grid and
 * the regime shells use this element, so the throw was unavoidable on any
 * successful open of the globe.
 *
 * The obvious tag would be `<line>`, which R3F does map to THREE.Line, but it
 * collides with SVG's `<line>` in React's JSX typings and produces a type
 * error on every use. Registering our own non-colliding name is the fix that
 * keeps both the compiler and the renderer happy; `extend` is exactly the
 * mechanism R3F provides for it. It must run at module scope so the catalogue
 * is populated before any of these components render.
 */
extend({ ThreeLine: THREE.Line });

/**
 * Background star field.
 *
 * Distributed uniformly on a sphere using the inverse-CDF method: naively
 * picking latitude and longitude uniformly clusters stars at the poles, which
 * is immediately visible as two bright caps. Brightness follows a power law so
 * a few stars dominate, as they do in a real sky.
 *
 * The field is fixed in the inertial frame, which is correct -- the stars are
 * what TEME is referenced to. It does not rotate with the Earth.
 */
export function Starfield({ count = 4500, radius = 90 }: { count?: number; radius?: number }) {
  const geometry = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);

    // Deterministic PRNG so the sky is identical across reloads. A star field
    // that reshuffles on every refresh looks like a glitch.
    let seed = 0x5eed1234;
    const rand = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return ((seed >>> 0) % 1_000_000) / 1_000_000;
    };

    const warm = new THREE.Color("#ffd9b3");
    const cool = new THREE.Color("#cfe0ff");
    const white = new THREE.Color("#ffffff");

    for (let i = 0; i < count; i++) {
      // Uniform on the sphere: z uniform in [-1, 1], azimuth uniform.
      const z = rand() * 2 - 1;
      const phi = rand() * Math.PI * 2;
      const r = Math.sqrt(1 - z * z);
      const d = radius * (0.85 + rand() * 0.3);

      positions[i * 3] = r * Math.cos(phi) * d;
      positions[i * 3 + 1] = z * d;
      positions[i * 3 + 2] = r * Math.sin(phi) * d;

      const t = rand();
      const c = t < 0.14 ? warm : t < 0.3 ? cool : white;
      const mag = Math.pow(rand(), 2.6);
      const brightness = 0.3 + mag * 0.7;

      colors[i * 3] = c.r * brightness;
      colors[i * 3 + 1] = c.g * brightness;
      colors[i * 3 + 2] = c.b * brightness;
      sizes[i] = 0.5 + mag * 2.6;
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    g.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
    return g;
  }, [count, radius]);

  return (
    <points geometry={geometry} raycast={() => null}>
      <shaderMaterial
        vertexShader={`
          attribute float size;
          attribute vec3 color;
          varying vec3 vColor;
          void main() {
            vColor = color;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = size;
            gl_Position = projectionMatrix * mv;
          }
        `}
        fragmentShader={`
          varying vec3 vColor;
          void main() {
            vec2 uv = gl_PointCoord - vec2(0.5);
            float d = length(uv);
            if (d > 0.5) discard;
            gl_FragColor = vec4(vColor, smoothstep(0.5, 0.1, d));
          }
        `}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

/**
 * An orbit path, drawn from server-propagated vertices.
 *
 * The vertex array is a real SGP4 trajectory sampled across one or more
 * revolutions. It is not an ellipse fitted to the current state, which would
 * ignore every perturbation SGP4 models.
 */
export function OrbitPath({
  positionsKm,
  color = "#2dd4bf",
  opacity = 0.55,
  linewidth = 1,
  dashed = false,
}: {
  positionsKm: number[];
  color?: string;
  opacity?: number;
  linewidth?: number;
  dashed?: boolean;
}) {
  const lineRef = useRef<THREE.Line>(null);

  const geometry = useMemo(() => {
    const n = Math.floor(positionsKm.length / 3);
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = positionsKm[i * 3] / KM_PER_UNIT;
      arr[i * 3 + 1] = positionsKm[i * 3 + 2] / KM_PER_UNIT;
      arr[i * 3 + 2] = -positionsKm[i * 3 + 1] / KM_PER_UNIT;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    return g;
  }, [positionsKm]);

  useEffect(() => {
    if (dashed && lineRef.current) {
      (lineRef.current as unknown as THREE.Line).computeLineDistances();
    }
  }, [dashed, geometry]);

  /**
   * Release the GPU buffer when this path is replaced or unmounted.
   *
   * A 320-vertex orbit is small, but this component remounts on every
   * selection change and every conjunction, and three.js does not garbage
   * collect GPU resources -- an undisposed BufferGeometry keeps its VBO alive
   * for the lifetime of the context. Over a demo's worth of clicking that is a
   * steady, invisible leak on exactly the integrated GPUs least able to spare
   * the memory.
   */
  useEffect(() => {
    return () => geometry.dispose();
  }, [geometry]);

  if (positionsKm.length < 6) return null;

  return (
    <threeLine ref={lineRef as never} geometry={geometry} raycast={() => null}>
      {dashed ? (
        <lineDashedMaterial
          color={color}
          transparent
          opacity={opacity}
          dashSize={0.06}
          gapSize={0.035}
          linewidth={linewidth}
        />
      ) : (
        <lineBasicMaterial
          color={color}
          transparent
          opacity={opacity}
          linewidth={linewidth}
        />
      )}
    </threeLine>
  );
}

/**
 * The closest-approach location: a pulsing marker at the encounter point plus
 * a line joining the two objects at TCA.
 *
 * The line length IS the miss distance, drawn to scale. At a few kilometres
 * against an Earth radius of 6,378 km it is invisibly short when zoomed out,
 * which is itself the honest picture: these encounters are tiny.
 */
export function ConjunctionMarker({
  positionAKm,
  positionBKm,
  color = "#f04747",
  pulse = true,
}: {
  positionAKm: [number, number, number];
  positionBKm: [number, number, number];
  color?: string;
  pulse?: boolean;
}) {
  const haloRef = useRef<THREE.Mesh>(null);
  const { camera } = useThree();

  const toScene = (p: [number, number, number]): [number, number, number] => [
    p[0] / KM_PER_UNIT,
    p[2] / KM_PER_UNIT,
    -p[1] / KM_PER_UNIT,
  ];

  const a = toScene(positionAKm);
  const b = toScene(positionBKm);
  const mid: [number, number, number] = [
    (a[0] + b[0]) / 2,
    (a[1] + b[1]) / 2,
    (a[2] + b[2]) / 2,
  ];

  const lineGeom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array([...a, ...b]), 3),
    );
    return g;
  }, [a[0], a[1], a[2], b[0], b[1], b[2]]);

  useFrame((state) => {
    if (!haloRef.current) return;
    haloRef.current.lookAt(camera.position);
    if (pulse) {
      const s = 1 + Math.sin(state.clock.elapsedTime * 2.4) * 0.22;
      haloRef.current.scale.setScalar(s);
    }
  });

  return (
    <group>
      <threeLine geometry={lineGeom} raycast={() => null}>
        <lineBasicMaterial color={color} transparent opacity={0.95} />
      </threeLine>
      <group position={mid}>
        <mesh ref={haloRef}>
          <ringGeometry args={[0.038, 0.05, 48]} />
          <meshBasicMaterial
            color={color}
            side={THREE.DoubleSide}
            transparent
            opacity={0.75}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
        <mesh>
          <sphereGeometry args={[0.009, 12, 12]} />
          <meshBasicMaterial color={color} />
        </mesh>
      </group>
    </group>
  );
}

/**
 * Equatorial reference ring and polar axis.
 *
 * Fixed in the inertial frame. Useful for reading inclination at a glance and
 * for making the Earth's rotation legible against a static reference.
 */
export function ReferenceGrid({ visible = true }: { visible?: boolean }) {
  const equator = useMemo(() => {
    const points: number[] = [];
    const segments = 256;
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      points.push(Math.cos(a) * 1.001, 0, Math.sin(a) * 1.001);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(points), 3));
    return g;
  }, []);

  const axis = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array([0, -1.35, 0, 0, 1.35, 0]), 3),
    );
    return g;
  }, []);

  if (!visible) return null;

  return (
    <group>
      <threeLine geometry={equator} raycast={() => null}>
        <lineBasicMaterial color="#2dd4bf" transparent opacity={0.16} />
      </threeLine>
      <threeLine geometry={axis} raycast={() => null}>
        <lineBasicMaterial color="#2dd4bf" transparent opacity={0.13} />
      </threeLine>
    </group>
  );
}

/**
 * Orbital-shell rings at the LEO/MEO boundary and GEO radius.
 * Purely a reading aid for altitude; carries no data of its own.
 */
export function RegimeShells({ visible = false }: { visible?: boolean }) {
  const rings = useMemo(() => {
    const make = (radiusKm: number) => {
      const points: number[] = [];
      const r = radiusKm / KM_PER_UNIT;
      for (let i = 0; i <= 200; i++) {
        const a = (i / 200) * Math.PI * 2;
        points.push(Math.cos(a) * r, 0, Math.sin(a) * r);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(points), 3));
      return g;
    };
    return [
      { geom: make(6378.137 + 2000), color: "#2dd4bf", label: "LEO ceiling" },
      { geom: make(6378.137 + 35786), color: "#4a9eda", label: "GEO" },
    ];
  }, []);

  if (!visible) return null;

  return (
    <group>
      {rings.map((r, i) => (
        <threeLine key={i} geometry={r.geom} raycast={() => null}>
          <lineBasicMaterial color={r.color} transparent opacity={0.12} />
        </threeLine>
      ))}
    </group>
  );
}
