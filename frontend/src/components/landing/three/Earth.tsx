/**
 * KAKSHA -- the landing page Earth.
 *
 * Distinct from the console's Earth, and deliberately so. The console globe is
 * an instrument: it is locked to GMST and lit from the backend's solar
 * ephemeris, because an operator reading a position off it needs the terminator
 * to be where the physics says it is. This one is a photograph. It turns slowly
 * for its own sake, is lit from a fixed direction chosen so the terminator
 * falls where the composition needs it, and dims on cue as the camera moves
 * through the page.
 *
 * The two share their TEXTURES, via `useEarthTextures` from the console globe.
 * Two Earths in one product should not disagree about what the planet looks
 * like, and that loader already handles progressive arrival and per-map failure.
 *
 * Uniforms are updated through the material REF, never by mutating the object
 * passed to the `uniforms` prop: React Three Fiber clones that object when it
 * applies it, so writes to the original reach nothing that is on screen.
 */
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useEarthTextures } from "../../globe/Earth";
import { SUN_DIRECTION } from "../lib/choreography";
import { scene } from "../lib/sceneStore";
import type { LayerState } from "../lib/sceneStore";

const surfaceVert = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vViewW;

  void main() {
    vUv = uv;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vViewW = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const surfaceFrag = /* glsl */ `
  uniform sampler2D uDay;
  uniform sampler2D uNight;
  uniform sampler2D uSpec;
  uniform sampler2D uNormal;
  uniform sampler2D uClouds;
  uniform vec3  uSun;
  uniform float uCloudOffset;
  uniform float uBrightness;
  uniform float uAtmo;
  uniform float uRelief;

  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vViewW;

  void main() {
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(vViewW);

    // Analytic tangent frame: on a sphere with equirectangular UVs the basis is
    // east / north / up, so the normal map needs no tangent attribute.
    vec3 east  = normalize(cross(vec3(0.0, 1.0, 0.0), N));
    vec3 north = cross(N, east);
    vec3 nm    = texture2D(uNormal, vUv).xyz * 2.0 - 1.0;
    N = normalize(mix(N, normalize(east * nm.x + north * nm.y + N * nm.z), uRelief));

    float ndl = dot(N, uSun);

    // Soft-wrapped lambert keeps the terminator a gradient. The crossover is
    // narrow on purpose: widen it and the city lights compress into a sliver at
    // the limb instead of the night side reading as night.
    float lambert = pow(clamp(ndl * 0.5 + 0.5, 0.0, 1.0), 1.7);
    float dayAmt  = smoothstep(-0.06, 0.15, ndl);

    vec3 dayTex   = texture2D(uDay, vUv).rgb;
    vec3 nightTex = texture2D(uNight, vUv).rgb;

    vec3 lit  = dayTex * (0.05 + 1.15 * lambert);
    vec3 dark = nightTex * 1.9 * (1.0 - dayAmt);

    vec3 col = mix(dark, lit, dayAmt);
    col += dayTex * 0.015;                      // faint ambient on the dark limb

    // Sun glint on water only, using the catalogue's own ocean mask. Kept tight
    // and dim: at this apparent size a loose highlight reads as a blown-out blob.
    float ocean = texture2D(uSpec, vUv).r;
    vec3  H     = normalize(uSun + V);
    float spec  = pow(max(dot(N, H), 0.0), 620.0) * ocean * dayAmt * lambert;
    col += vec3(0.42, 0.60, 0.80) * spec * 0.5;

    // Clouds drift very slightly faster than the surface beneath them.
    float cl = texture2D(uClouds, vec2(fract(vUv.x + uCloudOffset), vUv.y)).r;
    vec3  cloudCol = vec3(0.88, 0.93, 0.97) * (0.05 + 1.25 * lambert);
    col = mix(col, cloudCol, cl * 0.55 * (0.20 + 0.80 * dayAmt));
    col += vec3(0.90, 0.70, 0.44) * cl * (1.0 - dayAmt) * nightTex.r * 0.30;

    // Warm forward scatter on the day/night edge. Squared explicitly: GLSL
    // leaves pow() undefined for a negative base, and this one goes negative
    // across the whole night side.
    float tb   = (ndl - 0.01) * 15.0;
    float term = exp(-(tb * tb));
    col += vec3(0.40, 0.18, 0.06) * term * 0.2;

    // Fresnel rim -- the atmosphere seen edge-on through the limb. Restrained,
    // so it reads as air rather than as a drawn outline.
    float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.4);
    vec3  rim  = mix(vec3(0.03, 0.09, 0.18), vec3(0.16, 0.50, 0.74), dayAmt);
    col += rim * fres * 0.95 * uAtmo;

    col *= uBrightness;

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const atmoFrag = /* glsl */ `
  uniform vec3  uSun;
  uniform float uAtmo;

  varying vec3 vNormalW;
  varying vec3 vViewW;

  void main() {
    vec3  N = normalize(vNormalW);
    vec3  V = normalize(vViewW);
    // Back faces, so |N.V| peaks facing away: abs() puts the glow on the limb.
    float fres = pow(1.0 - abs(dot(N, V)), 2.6);
    float sun  = smoothstep(-0.55, 0.55, dot(N, uSun));

    vec3  col = mix(vec3(0.012, 0.05, 0.13), vec3(0.13, 0.48, 0.78), sun);
    float a   = fres * (0.12 + 0.88 * sun) * uAtmo * 0.78;

    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

interface EarthProps {
  layersRef: React.RefObject<LayerState>;
}

export function LandingEarth({ layersRef }: EarthProps) {
  const { dayMap, nightMap, cloudMap, normalMap, specMap } = useEarthTextures();

  const groupRef = useRef<THREE.Group>(null);
  const surfaceMatRef = useRef<THREE.ShaderMaterial>(null);
  const atmoMatRef = useRef<THREE.ShaderMaterial>(null);

  const sun = useMemo(
    () => new THREE.Vector3(...SUN_DIRECTION).normalize(),
    [],
  );

  /**
   * Built ONCE and mutated in place. Listing the textures as dependencies would
   * make every progressively-arriving map produce a new uniforms object, which
   * makes three.js recompile the shader -- four needless GPU stalls at startup.
   * The texture objects are swapped into the live uniforms below instead.
   */
  const surfaceInit = useMemo(
    () => ({
      uDay: { value: dayMap },
      uNight: { value: nightMap },
      uSpec: { value: specMap },
      uNormal: { value: normalMap },
      uClouds: { value: cloudMap },
      uSun: { value: sun.clone() },
      uCloudOffset: { value: 0 },
      uBrightness: { value: 1 },
      uAtmo: { value: 1 },
      uRelief: { value: 0.35 },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const atmoInit = useMemo(
    () => ({ uSun: { value: sun.clone() }, uAtmo: { value: 1 } }),
    [sun],
  );

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const layers = layersRef.current;

    // Slow and elegant (~0.9 deg/s): readable in a screen recording without
    // ever looking like a spinning globe demo.
    const spin = scene.reducedMotion ? 0.0018 : 0.016;
    if (groupRef.current) groupRef.current.rotation.y += spin * dt;

    const u = surfaceMatRef.current?.uniforms;
    if (u) {
      // Adopt each texture as it finishes loading, without rebuilding uniforms.
      if (u.uDay.value !== dayMap) u.uDay.value = dayMap;
      if (u.uNight.value !== nightMap) u.uNight.value = nightMap;
      if (u.uSpec.value !== specMap) u.uSpec.value = specMap;
      if (u.uNormal.value !== normalMap) u.uNormal.value = normalMap;
      if (u.uClouds.value !== cloudMap) u.uClouds.value = cloudMap;

      u.uCloudOffset.value += (scene.reducedMotion ? 0.00015 : 0.0016) * dt;
      u.uBrightness.value += (layers.earth - u.uBrightness.value) * 0.08;
      u.uAtmo.value += (layers.atmosphere - u.uAtmo.value) * 0.08;
    }

    const a = atmoMatRef.current?.uniforms;
    if (a) a.uAtmo.value += (layers.atmosphere - a.uAtmo.value) * 0.08;
  });

  const segments = scene.isMobile ? 64 : 128;

  return (
    <group>
      {/* Surface, tilted by Earth's axial obliquity. */}
      <group ref={groupRef} rotation={[0, 0, -0.4101524]}>
        <mesh>
          <sphereGeometry args={[1, segments, segments / 2]} />
          <shaderMaterial
            ref={surfaceMatRef}
            vertexShader={surfaceVert}
            fragmentShader={surfaceFrag}
            uniforms={surfaceInit}
          />
        </mesh>
      </group>

      {/* Atmosphere shell -- back faces only, so it reads as a limb halo. */}
      <mesh renderOrder={2}>
        <sphereGeometry args={[1.085, 64, 32]} />
        <shaderMaterial
          ref={atmoMatRef}
          vertexShader={surfaceVert}
          fragmentShader={atmoFrag}
          uniforms={atmoInit}
          transparent
          side={THREE.BackSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}
