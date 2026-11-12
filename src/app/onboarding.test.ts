import { describe, it, expect, beforeEach } from 'vitest';
import {
  ONBOARDING_SEEN_KEY,
  shouldShowOnboarding,
  markOnboardingSeen,
} from './onboarding';

beforeEach(() => {
  localStorage.clear();
});

describe('shouldShowOnboarding', () => {
  it('returns true on a fresh localStorage', () => {
    expect(shouldShowOnboarding()).toBe(true);
  });

  it('returns false once markOnboardingSeen has written the flag', () => {
    markOnboardingSeen();
    expect(shouldShowOnboarding()).toBe(false);
  });

  it('returns false for any non-null value stored under the key (back-compat-safe)', () => {
    localStorage.setItem(ONBOARDING_SEEN_KEY, 'true');
    expect(shouldShowOnboarding()).toBe(false);
    localStorage.setItem(ONBOARDING_SEEN_KEY, 'whatever');
    expect(shouldShowOnboarding()).toBe(false);
  });
});

describe('markOnboardingSeen', () => {
  it('writes the seen flag so subsequent boots stay quiet', () => {
    markOnboardingSeen();
    expect(localStorage.getItem(ONBOARDING_SEEN_KEY)).not.toBeNull();
  });

  it('is idempotent', () => {
    markOnboardingSeen();
    markOnboardingSeen();
    expect(shouldShowOnboarding()).toBe(false);
  });
});
