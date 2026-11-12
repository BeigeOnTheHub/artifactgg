// Future-proof consent gate. The app currently sets NO tracking cookies and
// runs NO analytics - only essential local storage (saved strats, theme, tool
// prefs). This module exists so that IF analytics is ever added, it can be
// gated behind hasConsent('analytics') and the banner already governs it.
// Bump CONSENT_VERSION whenever the categories or wording change to re-prompt.

export const CONSENT_KEY = 'artifact-gg.v2.consent';
export const CONSENT_VERSION = 1;

export type ConsentCategory = 'essential' | 'analytics';

export interface ConsentChoices {
  essential: true; // always on, not user-togglable
  analytics: boolean;
}

export interface ConsentRecord {
  version: number;
  choices: ConsentChoices;
  ts: number;
}

export function getConsent(): ConsentRecord | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(CONSENT_KEY);
  } catch {
    return null;
  }
  if (raw == null) return null;
  try {
    const p = JSON.parse(raw) as ConsentRecord;
    if (typeof p !== 'object' || p === null) return null;
    if (typeof p.version !== 'number') return null;
    return p;
  } catch {
    return null;
  }
}

/** True when we have no valid, current-version record yet. */
export function needsPrompt(): boolean {
  const rec = getConsent();
  return rec == null || rec.version < CONSENT_VERSION;
}

export function hasConsent(category: ConsentCategory): boolean {
  if (category === 'essential') return true;
  const rec = getConsent();
  if (rec == null || rec.version < CONSENT_VERSION) return false;
  return rec.choices[category] === true;
}

export function setConsent(choices: { analytics: boolean }): void {
  const rec: ConsentRecord = {
    version: CONSENT_VERSION,
    choices: { essential: true, analytics: choices.analytics },
    ts: Date.now(),
  };
  try {
    localStorage.setItem(CONSENT_KEY, JSON.stringify(rec));
  } catch {
    /* ignore storage write errors - worst case we prompt again next time */
  }
}
