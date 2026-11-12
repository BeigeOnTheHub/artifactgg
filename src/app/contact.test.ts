import { describe, it, expect } from 'vitest';
import { CONTACT_URL, CONTACT_LABEL } from './contact';

describe('contact', () => {
  it('exports a non-empty contact url and label', () => {
    expect(typeof CONTACT_URL).toBe('string');
    expect(CONTACT_URL.length).toBeGreaterThan(0);
    expect(typeof CONTACT_LABEL).toBe('string');
    expect(CONTACT_LABEL.length).toBeGreaterThan(0);
  });
});
