import { describe, it, expect } from 'vitest';
import { bootProfile } from './bootProfile';

describe('bootProfile', () => {
  it('desktop mode -> full editing profile', () => {
    expect(bootProfile('desktop')).toEqual({
      readOnly: false, mountTools: true, mountCreationTools: false,
      mountDesktopChrome: true, mountCompactChrome: false,
      viewport: 'mouse', touchEdit: false,
    });
  });
  it('compact mode -> touch-edit viewer profile', () => {
    expect(bootProfile('compact')).toEqual({
      readOnly: false, mountTools: false, mountCreationTools: true,
      mountDesktopChrome: false, mountCompactChrome: true,
      viewport: 'touch', touchEdit: true,
    });
  });
});
