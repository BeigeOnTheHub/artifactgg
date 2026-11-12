import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assertHex, hex, isHex, type Hex } from './hex';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = dirname(HERE);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('hex', () => {
  it('isHex accepts well-formed 6-digit hex strings', () => {
    expect(isHex('#aabbcc')).toBe(true);
    expect(isHex('#AABBCC')).toBe(true);
    expect(isHex('#012def')).toBe(true);
  });

  it('isHex rejects malformed strings', () => {
    expect(isHex('aabbcc')).toBe(false);
    expect(isHex('#abc')).toBe(false);
    expect(isHex('#abcdefg')).toBe(false);
    expect(isHex('#abcdeg')).toBe(false);
    expect(isHex('')).toBe(false);
  });

  it('hex() returns the input on a valid hex string', () => {
    expect(hex('#123abc')).toBe('#123abc');
  });

  it('hex() throws on an invalid hex string', () => {
    expect(() => hex('not a hex')).toThrow(/Invalid hex/);
  });

  it('assertHex narrows the type on a valid hex string', () => {
    const s: string = '#aabbcc';
    assertHex(s);
    const h: Hex = s;
    expect(h).toBe('#aabbcc');
  });

  it('assertHex throws on an invalid hex string', () => {
    expect(() => assertHex('nope')).toThrow(/Invalid hex/);
  });
});

describe('hex (codebase guard)', () => {
  it('forbids the branded cast outside types/hex.ts', () => {
    const offenders: string[] = [];
    const pattern = /\bas\s+Hex\b/;
    for (const file of walk(SRC_DIR)) {
      if (!file.endsWith('.ts')) continue;
      const rel = relative(SRC_DIR, file).replaceAll('\\', '/');
      if (rel === 'types/hex.ts' || rel === 'types/hex.test.ts') continue;
      const src = readFileSync(file, 'utf8');
      if (pattern.test(src)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
