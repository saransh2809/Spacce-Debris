/**
 * KAKSHA -- landing page 3D-to-DOM label bridge.
 *
 * In-scene labels are real DOM nodes so they stay crisp and selectable, but
 * they track projected 3D positions. The render loop writes transforms straight
 * onto the elements, so tracking a label costs nothing per frame and never
 * re-renders React.
 */

const targets = new Map<string, HTMLElement>();

export function registerLabel(key: string, el: HTMLElement | null): void {
  if (el) targets.set(key, el);
  else targets.delete(key);
}

/** How far outside the viewport a label may sit before it is dropped. */
const MARGIN = 96;

/**
 * @param x viewport pixels
 * @param y viewport pixels
 * @param opacity 0..1
 */
export function placeLabel(key: string, x: number, y: number, opacity: number): void {
  const el = targets.get(key);
  if (!el) return;

  // Labels are position:fixed, so one parked off-screen still counts toward the
  // page's horizontal overflow -- which on a phone expands the layout viewport
  // and quietly pushes the navigation off the right edge. An off-screen label
  // has nothing to say anyway, so it is hidden rather than merely transparent.
  const offscreen =
    x < -MARGIN ||
    y < -MARGIN ||
    x > window.innerWidth + MARGIN ||
    y > window.innerHeight + MARGIN;

  if (opacity <= 0.01 || offscreen) {
    if (el.style.visibility !== "hidden") el.style.visibility = "hidden";
    return;
  }

  if (el.style.visibility === "hidden") el.style.visibility = "";
  el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
  el.style.opacity = opacity.toFixed(3);
}

export function hideAllLabels(): void {
  for (const el of targets.values()) el.style.visibility = "hidden";
}
