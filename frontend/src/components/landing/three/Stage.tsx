/**
 * KAKSHA -- the landing page's WebGL stage.
 *
 * One Canvas, one renderer, one animation loop, fixed behind the whole page.
 * Every section's 3D content lives inside it, which is what lets the camera
 * travel continuously from the hero to the closing CTA instead of each section
 * owning an unrelated scene.
 */
import { Canvas } from "@react-three/fiber";
import { Component, useRef } from "react";
import type { ErrorInfo, ReactNode } from "react";
import * as THREE from "three";
import { hideAllLabels } from "../lib/labelBridge";
import { scene } from "../lib/sceneStore";
import type { LayerState } from "../lib/sceneStore";
import { CameraRig } from "./CameraRig";
import { ConjunctionPair } from "./ConjunctionPair";
import { LandingEarth } from "./Earth";
import { OrbitalField } from "./OrbitalField";
import { Starfield } from "./Starfield";

interface BoundaryProps {
  children: ReactNode;
  onFail?: (error: Error) => void;
}

/**
 * A WebGL failure must degrade to a dark backdrop with readable copy, never to
 * a blank page. The content layer is a SIBLING of this boundary, so it survives
 * intact when the scene does not.
 */
class StageBoundary extends Component<BoundaryProps, { failed: boolean }> {
  constructor(props: BoundaryProps) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surfaced deliberately: a silent 3D failure is the hardest kind to notice.
    console.error("[KAKSHA landing] 3D stage failed:", error, info.componentStack);
    hideAllLabels();
    this.props.onFail?.(error);
  }

  render() {
    if (this.state.failed) return <div className="stage-fallback" aria-hidden="true" />;
    return this.props.children;
  }
}

function Scene() {
  /**
   * Shared and mutated in place by the camera rig every frame. Passing it as a
   * ref rather than as state is the whole reason scrolling does not re-render
   * the React tree sixty times a second.
   */
  const layersRef = useRef<LayerState>({
    orbit: 0,
    rings: 0,
    pair: 0,
    earth: 1,
    stars: 1,
    atmosphere: 1,
  });

  return (
    <>
      <CameraRig layersRef={layersRef} />
      <Starfield layersRef={layersRef} />
      <LandingEarth layersRef={layersRef} />
      <OrbitalField layersRef={layersRef} />
      <ConjunctionPair layersRef={layersRef} />
    </>
  );
}

export function Stage({ onFail }: { onFail?: (error: Error) => void }) {
  return (
    <div className="stage" aria-hidden="true">
      <StageBoundary onFail={onFail}>
        <Canvas
          dpr={[1, 1.8]}
          camera={{ fov: 34, near: 0.04, far: 400, position: [0, 0, 5] }}
          gl={{
            antialias: true,
            alpha: false,
            powerPreference: "high-performance",
            stencil: false,
            depth: true,
          }}
          onCreated={({ gl }) => {
            gl.setClearColor(new THREE.Color("#02060d"), 1);
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 1.12;
            scene.ready = true;
          }}
        >
          <Scene />
        </Canvas>
      </StageBoundary>
    </div>
  );
}
