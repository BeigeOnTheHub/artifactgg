/**
 * First-run onboarding gating. Mirrors the version.ts changelog gate: a
 * single localStorage key flips from "never seen" to "seen" on the user's
 * first visit. main.ts prioritises onboarding over the changelog auto-open
 * for fresh installs -- the changelog is for "what changed since last
 * time", which is irrelevant when there is no last time.
 */

export const ONBOARDING_SEEN_KEY = 'artifact-gg.v2.onboardingSeen';

export function shouldShowOnboarding(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_SEEN_KEY) == null;
  } catch {
    // localStorage disabled -- don't pester the user. They get the silent
    // experience the same way they would for an in-private window.
    return false;
  }
}

export function markOnboardingSeen(): void {
  try {
    localStorage.setItem(ONBOARDING_SEEN_KEY, 'true');
  } catch {
    // Quota or disabled -- silent. Worst case the user sees the tour again
    // next time, which is mildly annoying but not broken.
  }
}
