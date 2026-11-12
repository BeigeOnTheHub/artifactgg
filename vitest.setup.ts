// jsdom 24 lacks PointerEvent and pointer-capture methods. Polyfill them here so
// every test file that dispatches pointer events sees the same minimal surface.
// Guarded by feature detection so real browsers and future jsdom versions are
// untouched.

if (typeof globalThis.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    public readonly pointerId: number;
    public readonly pointerType: string;
    public readonly isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? 'mouse';
      this.isPrimary = init.isPrimary ?? true;
    }
  }
  (globalThis as unknown as { PointerEvent: typeof PointerEventPolyfill }).PointerEvent =
    PointerEventPolyfill;
}

const elProto = HTMLElement.prototype as unknown as Record<string, unknown>;
if (typeof elProto['setPointerCapture'] !== 'function') {
  elProto['setPointerCapture'] = function (): void {};
}
if (typeof elProto['releasePointerCapture'] !== 'function') {
  elProto['releasePointerCapture'] = function (): void {};
}
if (typeof elProto['hasPointerCapture'] !== 'function') {
  elProto['hasPointerCapture'] = function (): boolean { return false; };
}
