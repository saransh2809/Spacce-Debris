/**
 * KAKSHA -- object sprites.
 *
 * WHY SPRITES AND NOT MESHES
 * --------------------------
 * A satellite drawn as real geometry is ~200 triangles and its own draw call.
 * Eighteen thousand of them is not a scene, it is a slideshow. These textures
 * are drawn once into an offscreen canvas and used as point sprites, so the
 * entire catalogue stays at one draw call per object class while still reading
 * as a satellite rather than a dot.
 *
 * WHY THEY ARE LUMINANCE MASKS
 * ----------------------------
 * The sprites are painted white-on-transparent with internal brightness
 * variation, then tinted per-point by the class colour in the shader. Shape
 * therefore carries "what kind of object this is" and colour carries "who owns
 * it / how risky it is" -- two independent channels instead of one overloaded
 * one. Painting the panels literally blue would collapse them back together
 * and lose the operator colour coding the left rail depends on.
 *
 * The silhouettes are deliberately chunky. On screen these occupy 6-18 px; any
 * detail finer than about 1/12th of the canvas is invisible, so the icon is
 * tuned to read at thumbnail size, not to be admired at full resolution.
 */
import * as THREE from "three";

const SIZE = 128;

function canvas2d(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = SIZE;
  c.height = SIZE;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  return [c, ctx];
}

function finish(c: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/** Soft outer glow so a sprite does not sit on the starfield with a hard edge. */
function glow(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, a: number) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, `rgba(255,255,255,${a})`);
  g.addColorStop(0.45, `rgba(255,255,255,${a * 0.28})`);
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SIZE, SIZE);
}

/**
 * Satellite: bus with two solar wings and a dish.
 *
 * Geometry mirrors a real spacecraft bus -- panels on a boom either side of a
 * body, a communications dish offset to one side -- because that is the
 * silhouette people recognise instantly at small scale.
 */
export function makeSatelliteSprite(): THREE.CanvasTexture {
  const [c, ctx] = canvas2d();
  const mid = SIZE / 2;

  glow(ctx, mid, mid, 60, 0.3);

  ctx.save();
  ctx.translate(mid, mid);
  ctx.rotate(-Math.PI / 9); // slight tilt: a level icon reads as a UI glyph

  // --- solar wings -------------------------------------------------------
  // Drawn at partial brightness so the bus stays the brightest element and the
  // icon keeps a clear centre of mass when it shrinks to a few pixels.
  const wingW = 34;
  const wingH = 21;
  const boom = 13;

  for (const dir of [-1, 1]) {
    const x = dir * (boom + (dir < 0 ? wingW : 0));

    ctx.fillStyle = "rgba(255,255,255,0.80)";
    ctx.fillRect(x, -wingH / 2, wingW, wingH);

    // Cell gaps, cut as darker seams. Two verticals and one horizontal is
    // enough to say "solar array" without turning to mush at 8 px.
    ctx.fillStyle = "rgba(255,255,255,0.30)";
    ctx.fillRect(x + wingW / 3 - 1.2, -wingH / 2, 2.4, wingH);
    ctx.fillRect(x + (2 * wingW) / 3 - 1.2, -wingH / 2, 2.4, wingH);
    ctx.fillRect(x, -1.4, wingW, 2.8);

    // Bright leading edge: catches the eye and separates wing from background.
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fillRect(x, -wingH / 2, wingW, 2);

    // Boom connecting wing to bus.
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    const bx = dir < 0 ? -boom : boom - 1;
    ctx.fillRect(Math.min(bx, dir * boom), -2, boom, 4);
  }

  // --- bus ---------------------------------------------------------------
  ctx.fillStyle = "rgba(255,255,255,1.0)";
  ctx.fillRect(-13, -16, 26, 32);

  // Panel line across the bus, and a darker instrument face, so the body has
  // internal structure instead of being a white slab.
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.fillRect(-13, -3, 26, 2.5);
  ctx.fillRect(4, -13, 8, 10);

  // --- dish --------------------------------------------------------------
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.beginPath();
  ctx.ellipse(-22, 9, 11, 8, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.beginPath();
  ctx.ellipse(-22, 9, 5.5, 4, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(-16, 6);
  ctx.lineTo(-9, 1);
  ctx.stroke();

  // --- antenna -----------------------------------------------------------
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(6, -16);
  ctx.lineTo(11, -30);
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,1)";
  ctx.beginPath();
  ctx.arc(11, -31, 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
  return finish(c);
}

/**
 * Space station: a larger truss with four wing pairs.
 *
 * Distinct from a satellite at a glance because the silhouette is long and
 * symmetric rather than compact.
 */
export function makeStationSprite(): THREE.CanvasTexture {
  const [c, ctx] = canvas2d();
  const mid = SIZE / 2;

  glow(ctx, mid, mid, 64, 0.34);

  ctx.save();
  ctx.translate(mid, mid);
  ctx.rotate(-Math.PI / 10);

  // Main truss.
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.fillRect(-52, -2.5, 104, 5);

  // Four wing pairs along the truss.
  for (const x of [-44, -22, 14, 34]) {
    for (const dir of [-1, 1]) {
      ctx.fillStyle = "rgba(255,255,255,0.78)";
      ctx.fillRect(x, dir < 0 ? -25 : 5, 18, 20);
      ctx.fillStyle = "rgba(255,255,255,0.32)";
      ctx.fillRect(x, dir < 0 ? -15.5 : 14.5, 18, 2);
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.fillRect(x, dir < 0 ? -25 : 5, 18, 1.8);
    }
  }

  // Pressurised modules at the centre.
  ctx.fillStyle = "rgba(255,255,255,1)";
  ctx.fillRect(-10, -8, 22, 16);
  ctx.fillRect(-2, -16, 8, 32);

  ctx.restore();
  return finish(c);
}

/**
 * Rocket body: a spent upper stage. A capsule with a nozzle -- elongated, so
 * it never gets confused with either a satellite or a debris fragment.
 */
export function makeRocketBodySprite(): THREE.CanvasTexture {
  const [c, ctx] = canvas2d();
  const mid = SIZE / 2;

  glow(ctx, mid, mid, 46, 0.3);

  ctx.save();
  ctx.translate(mid, mid);
  ctx.rotate(-Math.PI / 5);

  // Cylindrical stage. `roundRect` is recent enough that a miss would throw
  // and take the whole sprite cache -- and therefore the entire scene -- with
  // it, so fall back to a plain rect rather than risk a blank globe.
  ctx.fillStyle = "rgba(255,255,255,0.96)";
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(-11, -30, 22, 52, 8);
  } else {
    ctx.rect(-11, -30, 22, 52);
  }
  ctx.fill();

  // Interstage bands.
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.fillRect(-11, -14, 22, 3);
  ctx.fillRect(-11, 4, 22, 3);

  // Engine bell.
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.beginPath();
  ctx.moveTo(-8, 22);
  ctx.lineTo(8, 22);
  ctx.lineTo(13, 34);
  ctx.lineTo(-13, 34);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
  return finish(c);
}

/**
 * Debris: a small irregular fragment.
 *
 * Intentionally low-contrast and asymmetric. Debris outnumbers everything else
 * by an order of magnitude, so its sprite has to recede visually or the display
 * turns into noise -- the fragment reads as texture in bulk and as a distinct
 * chip when you zoom in.
 */
export function makeDebrisSprite(): THREE.CanvasTexture {
  const [c, ctx] = canvas2d();
  const mid = SIZE / 2;

  glow(ctx, mid, mid, 30, 0.22);

  ctx.save();
  ctx.translate(mid, mid);

  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.beginPath();
  ctx.moveTo(-14, -8);
  ctx.lineTo(4, -16);
  ctx.lineTo(16, -1);
  ctx.lineTo(8, 15);
  ctx.lineTo(-9, 12);
  ctx.closePath();
  ctx.fill();

  // A facet, so it looks tumbled rather than like a blob.
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.beginPath();
  ctx.moveTo(-14, -8);
  ctx.lineTo(4, -16);
  ctx.lineTo(2, 2);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
  return finish(c);
}

/** Plain soft dot, used when points must stay abstract (DENSITY view). */
export function makeDotSprite(): THREE.CanvasTexture {
  const [c, ctx] = canvas2d();
  const mid = SIZE / 2;
  const g = ctx.createRadialGradient(mid, mid, 0, mid, mid, mid);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.85)");
  g.addColorStop(0.72, "rgba(255,255,255,0.18)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SIZE, SIZE);
  return finish(c);
}

/** Built once per page, reused by every layer. */
let cache: Record<string, THREE.CanvasTexture> | null = null;

export function getSprites() {
  if (!cache) {
    cache = {
      satellite: makeSatelliteSprite(),
      station: makeStationSprite(),
      rocket: makeRocketBodySprite(),
      debris: makeDebrisSprite(),
      dot: makeDotSprite(),
    };
  }
  return cache;
}

/**
 * The same satellite silhouette as an inline SVG, for the legend and the
 * selected-object thumbnail. Keeping the DOM icon and the 3D sprite visually
 * identical is what makes the legend actually usable as a key.
 */
export const SATELLITE_SVG = `
<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
  <g transform="rotate(-20 24 24)">
    <rect x="1" y="18" width="13" height="9" rx="1" fill="currentColor" opacity="0.75"/>
    <rect x="1" y="18" width="13" height="1.4" fill="currentColor"/>
    <rect x="6.6" y="18" width="1" height="9" fill="currentColor" opacity="0.35"/>
    <rect x="34" y="18" width="13" height="9" rx="1" fill="currentColor" opacity="0.75"/>
    <rect x="34" y="18" width="13" height="1.4" fill="currentColor"/>
    <rect x="40" y="18" width="1" height="9" fill="currentColor" opacity="0.35"/>
    <rect x="14" y="21.4" width="5" height="2.2" fill="currentColor" opacity="0.9"/>
    <rect x="29" y="21.4" width="5" height="2.2" fill="currentColor" opacity="0.9"/>
    <rect x="18.5" y="15.5" width="11" height="14" rx="1.4" fill="currentColor"/>
    <rect x="18.5" y="21" width="11" height="1.2" fill="currentColor" opacity="0.45"/>
    <ellipse cx="15" cy="32" rx="4.6" ry="3.4" transform="rotate(-28 15 32)" fill="currentColor" opacity="0.9"/>
    <path d="M18 30.4 L21.5 27.8" stroke="currentColor" stroke-width="1.3"/>
    <path d="M26 15.5 L28 9" stroke="currentColor" stroke-width="1.2"/>
    <circle cx="28.2" cy="8.2" r="1.5" fill="currentColor"/>
  </g>
</svg>`.trim();
