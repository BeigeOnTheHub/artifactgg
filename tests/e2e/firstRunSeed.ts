import type { Page } from '@playwright/test';
import { APP_VERSION, LAST_SEEN_KEY } from '../../src/app/version';
import { ONBOARDING_SEEN_KEY } from '../../src/app/onboarding';
import { CONSENT_KEY, CONSENT_VERSION } from '../../src/app/consent';

/**
 * Wipe storage, then mark every first-run interstitial as already seen.
 *
 * A fresh context gets the changelog modal, onboarding tour and consent banner,
 * which swallow a test's first tap, so any clicking spec needs all three seeded.
 * Seeds from the live constants so a version bump can't quietly bring the
 * changelog back. Specs that want an interstitial call this, then override in a
 * later addInitScript (those run after this one).
 */
export const FIRST_RUN_ENTRIES: ReadonlyArray<readonly [string, string]> = [
  [LAST_SEEN_KEY, APP_VERSION],
  [ONBOARDING_SEEN_KEY, 'true'],
  [CONSENT_KEY, JSON.stringify({
    version: CONSENT_VERSION, choices: { essential: true, analytics: false }, ts: Date.now(),
  })],
];

export async function seedFirstRun(page: Page): Promise<void> {
  await page.addInitScript((entries: ReadonlyArray<readonly [string, string]>) => {
    try {
      // Defensive against ever reusing a context; Playwright's default
      // fixtures already give each test its own. Also resets anything a
      // previous test persisted, e.g. artifact.frame-play-delay.
      localStorage.clear();
      for (const [k, v] of entries) localStorage.setItem(k, v);
    } catch { /* localStorage disabled - let the test fail naturally */ }
  }, FIRST_RUN_ENTRIES);
}
