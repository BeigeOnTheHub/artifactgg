const POINTER_EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'] as const;

/**
 * Insulate floating compact chrome (tool rail, top bar, sheets) from the map.
 * It mounts inside `#map-viewer`, where creation tools listen in the bubble
 * phase, so without this a chrome tap would draw on the map.
 *
 * Sets `data-touch-chrome` (TouchViewportController ignores those events) and
 * stops pointer events bubbling. Bubble phase is deliberate: inner handlers
 * like the colour wheel have already run by the time the event reaches the root.
 */
export function insulateChromePointerEvents(el: HTMLElement): void {
  el.dataset['touchChrome'] = '';
  // No teardown handle: these listeners are bound to a chrome root that is
  // removed wholesale on destroy(), so they are garbage-collected with it.
  for (const type of POINTER_EVENTS) {
    el.addEventListener(type, (e) => e.stopPropagation());
  }
}
