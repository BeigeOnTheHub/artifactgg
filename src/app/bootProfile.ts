import type { LayoutMode } from './layoutMode';

export interface BootProfile {
  readOnly: boolean;
  mountTools: boolean;
  /**
   * Compact only: construct the seven creation tool controllers and a
   * ToolsManager whose map holds just those seven. Distinct from `mountTools` - that gates the desktop-only full
   * build (all 11 tools + registerAll / keyboard / sidebar / topbar), which
   * compact must not mount.
   */
  mountCreationTools: boolean;
  mountDesktopChrome: boolean;
  mountCompactChrome: boolean;
  viewport: 'mouse' | 'touch';
  touchEdit: boolean;
}

/**
 * The single decision point for what `main.ts` constructs, so layout changes
 * stay out of the `main.ts` wiring.
 *
 * Nothing runtime-gates on `readOnly`; it has no consumer at the moment.
 */
export function bootProfile(mode: LayoutMode): BootProfile {
  if (mode === 'compact') {
    return {
      readOnly: false,
      mountTools: false,
      mountCreationTools: true,
      mountDesktopChrome: false,
      mountCompactChrome: true,
      viewport: 'touch',
      touchEdit: true,
    };
  }
  return {
    readOnly: false,
    mountTools: true,
    mountCreationTools: false,
    mountDesktopChrome: true,
    mountCompactChrome: false,
    viewport: 'mouse',
    touchEdit: false,
  };
}
