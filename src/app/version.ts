/**
 * APP_VERSION is hand-edited per release. If the stored last-seen version
 * differs, the changelog modal auto-opens once and markChangelogSeen() records it.
 */

export const APP_VERSION = '3.0.0';
export const LAST_SEEN_KEY = 'artifact-gg.v2.lastSeenChangelog';

export function shouldAutoOpenChangelog(): boolean {
  let seen: string | null;
  try {
    seen = localStorage.getItem(LAST_SEEN_KEY);
  } catch {
    return false; // localStorage disabled - don't pester the user.
  }
  return seen !== APP_VERSION;
}

export function markChangelogSeen(): void {
  try {
    localStorage.setItem(LAST_SEEN_KEY, APP_VERSION);
  } catch {
    // Quota or disabled - silent. The next boot will re-auto-open.
  }
}
