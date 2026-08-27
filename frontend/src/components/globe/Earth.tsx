/**
 * KAKSHA -- the Earth.
 *
 * COORDINATE MAPPING
 * ------------------
 * The physics is in TEME, where +Z is the north pole. Three.js renders with +Y
 * up. The mapping used everywhere in the 3D layer is
 *
 *     (x, y, z)_TEME  ->  (x, z, -y)_three
 *
 * which is a pure axis relabelling with determinant +1, so handedness and all
 * angles are preserved. It is applied in exactly one function, `temeToScene`,
 * and nothing in the scene is allowed to convert coordinates by hand.
 *
 * EARTH ROTATION
 * --------------
 * Satellite positions arrive in the INERTIAL frame and are never rotated. The
 * Earth mesh instead spins by GMST, which is both physically correct and about
 * twelve thousand times less work than rotating every object. The prime
 * meridian of the texture sits at the mesh's +X, and rotating the mesh by GMST
 * about the pole puts it exactly where the Earth-fixed frame says it should be.
 *
 * DAY/NIGHT
 * ---------
 * The terminator is computed from the real solar direction supplied by the
 * backend (Vallado's analytic solar ephemeris), not from a fudged offset.
 * Where the surface faces away from the Sun, the NASA city-lights texture
 * shows through. The blend width approximates civil twilight rather than being
 * a hard line, because the real terminator is not a hard line.
 */
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

export const EARTH_RADIUS_KM = 6378.137;
/**
 * Earth's sidereal rotation rate, rad/s (IERS).
 *
 * The backend supplies authoritative GMST roughly once a second. Holding that
 * value fixed until the next poll makes the Earth visibly step rather than
 * turn, so between polls the mesh advances at this rate and re-anchors to the
 * server value each time one arrives. The interpolation is linear, which over
 * a one-second gap is exact to well under a microradian.
 */
export const EARTH_ROTATION_RAD_S = 7.292115e-5;
/** Scene units per Earth radius. Positions in km are divided by this. */
export const KM_PER_UNIT = EARTH_RADIUS_KM;

/** TEME -> Three.js scene coordinates. The only place this conversion exists. */
export function temeToScene(x: number, y: number, z: number): [number, number, number] {
  return [x / KM_PER_UNIT, z / KM_PER_UNIT, -y / KM_PER_UNIT];
}

export function temeVecToScene(v: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(v.x / KM_PER_UNIT, v.z / KM_PER_UNIT, -v.y / KM_PER_UNIT);
}

const EARTH_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormalW;
void main() {
  vUv = uv;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const EARTH_FRAG = /* glsl */ `
uniform sampler2D dayMap;
uniform sampler2D nightMap;
uniform sampler2D specMap;
uniform sampler2D normalMap;
uniform vec3 sunDir;
uniform float nightBoost;
uniform float reliefStrength;
uniform float dayBoost;
uniform float ambientFloor;
varying vec2 vUv;
varying vec3 vNormalW;

void main() {
  vec3 n = normalize(vNormalW);
  vec3 s = normalize(sunDir);

  // Tangent-space relief. On a sphere with standard equirectangular UVs the
  // tangent frame is analytic -- east, north, up -- so no precomputed tangent
  // attribute is needed. This is what gives mountain ranges visible shading
  // near the terminator instead of a smooth painted sphere.
  vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), n));
  vec3 north = cross(n, east);
  vec3 nm = texture2D(normalMap, vUv).xyz * 2.0 - 1.0;
  n = normalize(mix(n, normalize(east * nm.x + north * nm.y + n * nm.z), reliefStrength));

  float cosAngle = dot(n, s);

  // Civil twilight spans roughly 18 degrees below the horizon; this blend is a
  // soft band around the geometric terminator rather than a hard edge. The
  // band is biased slightly toward the day side so the lit hemisphere reaches
  // full brightness well before the limb, rather than staying in permanent
  // dusk across a third of the visible disc.
  float daylight = smoothstep(-0.20, 0.14, cosAngle);

  vec3 dayColor = texture2D(dayMap, vUv).rgb;
  vec3 nightColor = texture2D(nightMap, vUv).rgb;
  float ocean = texture2D(specMap, vUv).r;

  // Lambertian falloff on the lit side, with an ambient floor so the limb does
  // not crush to black. The floor is raised well above a physically strict
  // value: real orbital imagery is lit by a single hard source, but a display
  // that is legible at a glance matters more here than radiometric purity, and
  // the terminator still lands in the geometrically correct place.
  float lambert = max(cosAngle, 0.0);
  vec3 lit = dayColor * (ambientFloor + 1.02 * lambert) * dayBoost;

  // A restrained specular sheen on water only. Land should not glint.
  float spec = pow(max(cosAngle, 0.0), 22.0) * ocean * 0.18;
  lit += vec3(0.45, 0.58, 0.75) * spec;

  // City lights appear only where the Sun has set, and are attenuated through
  // the twilight band so they fade in rather than switching on.
  vec3 night = nightColor * nightBoost * (1.0 - daylight);

  vec3 color = mix(night, lit, daylight);

  // Slight cool cast on the unlit hemisphere: airglow and moonlight are not
  // neutral, and a pure-black night side reads as a hole in the render.
  color += vec3(0.012, 0.018, 0.034) * (1.0 - daylight);

  gl_FragColor = vec4(color, 1.0);
}
`;

const ATMOSPHERE_VERT = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vWorldPos;
void main() {
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const ATMOSPHERE_FRAG = /* glsl */ `
uniform vec3 sunDir;
uniform vec3 glowColor;
uniform float strength;
varying vec3 vNormalW;
varying vec3 vWorldPos;

void main() {
  vec3 n = normalize(vNormalW);
  vec3 viewDir = normalize(cameraPosition - vWorldPos);

  // Rim term: thickest where the line of sight grazes the limb, which is where
  // an atmosphere actually has the most air to look through.
  float rim = 1.0 - max(dot(viewDir, n), 0.0);
  rim = pow(clamp(rim, 0.0, 1.0), 2.6);

  // Forward scattering: the limb glows brightest on the sunlit side.
  float sun = max(dot(n, normalize(sunDir)), 0.0);
  float intensity = rim * (0.16 + 0.84 * sun) * strength;

  gl_FragColor = vec4(glowColor, clamp(intensity, 0.0, 1.0));
}
`;

/**
 * Load the Earth maps resiliently, and progressively.
 *
 * This replaced `useLoader(TextureLoader, [five urls])`. That call suspends
 * until ALL five decode, and -- with no error boundary above it -- a single
 * failed or slow texture took down the entire application rather than the one
 * map that failed. It also meant nothing at all was drawn until the last byte
 * of the last texture arrived.
 *
 * Here every map starts as a neutral 1x1 placeholder, so the sphere, the
 * lighting and the terminator are correct from the first frame. Each real
 * texture swaps in as it arrives, and a failure is confined to its own map:
 * a missing specular texture costs the ocean sheen, not the planet.
 */
function makePlaceholder(r: number, g: number, b: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(
    new Uint8Array([r, g, b, 255]),
    1,
    1,
    THREE.RGBAFormat,
  );
  tex.needsUpdate = true;
  return tex;
}

interface EarthTextures {
  dayMap: THREE.Texture;
  nightMap: THREE.Texture;
  cloudMap: THREE.Texture;
  normalMap: THREE.Texture;
  specMap: THREE.Texture;
  loaded: number;
  total: number;
  failed: string[];
}

function useEarthTextures(): EarthTextures {
  // Placeholders chosen so a not-yet-loaded map is neutral rather than wrong:
  // a mid-blue ocean, black night side, no cloud, flat normal, no specular.
  const placeholders = useMemo(
    () => ({
      dayMap: makePlaceholder(24, 44, 74),
      nightMap: makePlaceholder(0, 0, 0),
      cloudMap: makePlaceholder(0, 0, 0),
      normalMap: makePlaceholder(128, 128, 255),
      specMap: makePlaceholder(0, 0, 0),
    }),
    [],
  );

  const [state, setState] = useState<EarthTextures>(() => ({
    ...placeholders,
    loaded: 0,
    total: 5,
    failed: [],
  }));

  useEffect(() => {
    const loader = new THREE.TextureLoader();
    let cancelled = false;
    const created: THREE.Texture[] = [];

    const jobs: {
      key: keyof typeof placeholders;
      url: string;
      srgb: boolean;
    }[] = [
      { key: "dayMap", url: "/textures/earth_atmos_2048.jpg", srgb: true },
      { key: "nightMap", url: "/textures/earth_lights_2048.png", srgb: true },
      { key: "cloudMap", url: "/textures/earth_clouds_1024.png", srgb: true },
      // Normal and specular are DATA, not colour. Tagging them sRGB would
      // gamma-decode them and quietly corrupt both the relief and the ocean
      // mask.
      { key: "normalMap", url: "/textures/earth_normal_2048.jpg", srgb: false },
      { key: "specMap", url: "/textures/earth_specular_2048.jpg", srgb: false },
    ];

    for (const job of jobs) {
      loader.load(
        job.url,
        (tex) => {
          if (cancelled) {
            tex.dispose();
            return;
          }
          if (job.srgb) tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = 8;
          tex.needsUpdate = true;
          created.push(tex);
          setState((s) => ({ ...s, [job.key]: tex, loaded: s.loaded + 1 }));
        },
        undefined,
        () => {
          if (cancelled) return;
          // Keep the placeholder for this map and carry on. One missing
          // texture must never cost the whole scene.
          setState((s) => ({
            ...s,
            loaded: s.loaded + 1,
            failed: [...s.failed, job.url],
          }));
        },
      );
    }

    return () => {
      cancelled = true;
      // Dispose only what THIS mount created. The placeholders are owned by
      // the memo and are still referenced while the component lives.
      for (const t of created) t.dispose();
    };
  }, [placeholders]);

  // Placeholders outlive every load, so they are released with the component.
  useEffect(() => {
    return () => {
      for (const t of Object.values(placeholders)) t.dispose();
    };
  }, [placeholders]);

  return state;
}

interface EarthProps {
  /** GMST in radians. Drives the mesh rotation. */
  gmst: number;
  /** Solar direction in TEME, unit vector. */
  sunTeme: [number, number, number];
  showClouds?: boolean;
  quality?: "high" | "low";
  /**
   * Current simulation time in ms. Read every frame (not a React dependency)
   * so rotation stays smooth without re-rendering the component tree.
   */
  simNowMs?: () => number;
}

export function Earth({
  gmst,
  sunTeme,
  showClouds = true,
  quality = "high",
  simNowMs,
}: EarthProps) {
  const { dayMap, nightMap, cloudMap, normalMap, specMap } = useEarthTextures();

  const earthRef = useRef<THREE.Mesh>(null);
  const cloudRef = useRef<THREE.Mesh>(null);

  const sunSceneVec = useMemo(
    () => new THREE.Vector3(...temeToScene(sunTeme[0], sunTeme[1], sunTeme[2])).normalize(),
    [sunTeme],
  );

  /**
   * Built ONCE and mutated in place.
   *
   * The dependency list used to include the texture objects, so every texture
   * that arrived produced a new uniforms object -- which makes three.js tear
   * down and recompile the shader program. With progressive loading that is
   * four needless recompiles during startup, each one a synchronous GPU stall
   * on exactly the machines least able to absorb it.
   */
  const earthUniforms = useMemo(
    () => ({
      dayMap: { value: dayMap },
      nightMap: { value: nightMap },
      specMap: { value: specMap },
      normalMap: { value: normalMap },
      sunDir: { value: sunSceneVec.clone() },
      nightBoost: { value: 2.1 },
      // Restrained: real terrain relief is invisible at this scale, so the map
      // is used for shading texture, not to fake mountains kilometres high.
      reliefStrength: { value: 0.42 },
      dayBoost: { value: 1.34 },
      ambientFloor: { value: 0.22 },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Swap texture references as they load. Assigning to `.value` rebinds the
  // sampler without touching the compiled program.
  useEffect(() => {
    earthUniforms.dayMap.value = dayMap;
    earthUniforms.nightMap.value = nightMap;
    earthUniforms.specMap.value = specMap;
    earthUniforms.normalMap.value = normalMap;
  }, [earthUniforms, dayMap, nightMap, specMap, normalMap]);

  const atmoUniforms = useMemo(
    () => ({
      sunDir: { value: sunSceneVec.clone() },
      glowColor: { value: new THREE.Color("#3f8fd8") },
      strength: { value: 1.28 },
    }),
    [],
  );

  // Re-anchor to the server's GMST whenever a fresh one arrives; between polls
  // the frame loop below extrapolates from this anchor.
  const anchor = useRef({ gmst, simMs: simNowMs?.() ?? Date.now() });
  useEffect(() => {
    anchor.current = { gmst, simMs: simNowMs?.() ?? Date.now() };
  }, [gmst, simNowMs]);

  useFrame(() => {
    earthUniforms.sunDir.value.copy(sunSceneVec);
    atmoUniforms.sunDir.value.copy(sunSceneVec);

    const nowMs = simNowMs?.() ?? Date.now();
    const theta =
      anchor.current.gmst +
      EARTH_ROTATION_RAD_S * ((nowMs - anchor.current.simMs) / 1000);

    if (earthRef.current) earthRef.current.rotation.y = theta;
    if (cloudRef.current) {
      // Clouds are not Earth-fixed. A small extra rate stands in for prevailing
      // winds; it is cosmetic and affects nothing numerical.
      cloudRef.current.rotation.y = theta * 1.006;
    }
  });

  const segments = quality === "high" ? 128 : 64;

  return (
    <group>
      <mesh ref={earthRef} renderOrder={1}>
        <sphereGeometry args={[1, segments, segments / 2]} />
        <shaderMaterial
          vertexShader={EARTH_VERT}
          fragmentShader={EARTH_FRAG}
          uniforms={earthUniforms}
        />
      </mesh>

      {showClouds && (
        <mesh ref={cloudRef} renderOrder={2}>
          <sphereGeometry args={[1.006, segments / 2, segments / 4]} />
          <meshLambertMaterial
            map={cloudMap}
            transparent
            opacity={0.40}
            depthWrite={false}
            blending={THREE.NormalBlending}
          />
        </mesh>
      )}

      {/* Atmospheric limb. BackSide so we see the far edge of the shell. */}
      <mesh renderOrder={3}>
        <sphereGeometry args={[1.035, 64, 32]} />
        <shaderMaterial
          vertexShader={ATMOSPHERE_VERT}
          fragmentShader={ATMOSPHERE_FRAG}
          uniforms={atmoUniforms}
          side={THREE.BackSide}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {/* Sun light, positioned along the true solar direction so the cloud
          layer's Lambert shading agrees with the shader terminator. */}
      <directionalLight
        position={sunSceneVec.clone().multiplyScalar(60)}
        intensity={3.1}
        color="#fff6e8"
      />
      <ambientLight intensity={0.16} color="#5b83bd" />
    </group>
  );
}
