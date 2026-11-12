import { describe, it, expect, vi } from 'vitest';
import {
  serialize,
  deserialize,
  encodeHash,
  decodeHash,
  writeStratToFile,
  readStratFromFile,
  type StratFile,
} from './persistence';
import { emptyFrame } from '../types/primitives';

const FILE: StratFile = {
  v: 2,
  map: 'miru',
  notes: 'peek long',
  view: { zoom: 1.5, panX: 20, panY: -10 },
  frames: [emptyFrame()],
  activeFrame: 0,
};

function makeStratFile(): StratFile {
  return {
    v: 2,
    map: 'miru',
    notes: 'peek long',
    view: { zoom: 1.5, panX: 20, panY: -10 },
    frames: [emptyFrame()],
    activeFrame: 0,
  };
}

// A strat with enough repetitive content for LZ compression to outperform raw JSON.
const RICH_FILE: StratFile = {
  v: 2,
  map: 'suna',
  notes: 'watch mid watch mid watch mid watch mid watch mid',
  view: { zoom: 1.0, panX: 0, panY: 0 },
  frames: [
    {
      ...emptyFrame(),
      players: Array.from({ length: 10 }, (_, i) => ({
        id: `player-${i}`,
        team: i < 5 ? 'colonist' : 'reyab',
        x: 100 + i * 50,
        y: 200 + i * 30,
        name: `Player${i}`,
        dead: false,
      })),
      strokes: Array.from({ length: 5 }, (_, i) => ({
        id: `stroke-${i}`,
        type: 'draw' as const,
        color: '#ff0000' as import('../types/hex').Hex,
        alpha: 1,
        size: 4,
        points: Array.from({ length: 20 }, (_, j) => ({ x: j * 10, y: i * 10 })),
      })),
    },
  ],
  activeFrame: 0,
};

describe('persistence', () => {
  it('serialize then deserialize is identity', () => {
    const s = serialize(FILE);
    const round = deserialize(s);
    expect(round).toEqual(FILE);
  });

  it('keeps a stroke dash style through a round-trip', () => {
    const file: StratFile = {
      ...makeStratFile(),
      frames: [{
        ...emptyFrame(),
        strokes: [{
          id: 'dashed-1',
          type: 'draw' as const,
          color: '#00ff88' as import('../types/hex').Hex,
          alpha: 1,
          size: 6,
          points: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
          dash: 'dashed' as const,
        }],
      }],
    };
    const round = deserialize(serialize(file));
    expect(round.frames[0]!.strokes[0]!.dash).toBe('dashed');
  });

  it('drops an unknown dash value on load', () => {
    const file = {
      ...makeStratFile(),
      frames: [{
        ...emptyFrame(),
        strokes: [{
          id: 'bogus-1',
          type: 'draw',
          color: '#00ff88',
          alpha: 1,
          size: 6,
          points: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
          dash: 'zigzag',
        }],
      }],
    };
    const round = deserialize(serialize(file as unknown as StratFile));
    expect(round.frames[0]!.strokes[0]!.dash).toBeUndefined();
  });

  it('encodeHash -> decodeHash is identity', () => {
    const h = encodeHash(FILE);
    const back = decodeHash(h);
    expect(back).toEqual(FILE);
  });

  it('encodeHash output is smaller than raw JSON for a non-trivial strat', () => {
    const raw = JSON.stringify(RICH_FILE);
    const h = encodeHash(RICH_FILE);
    expect(h.length).toBeLessThan(raw.length);
  });

  it('deserialize throws on a clearly-invalid payload', () => {
    expect(() => deserialize('{}')).toThrow();
    expect(() => deserialize('not json')).toThrow();
  });

  it('decodeHash returns null on corrupt input', () => {
    expect(decodeHash('')).toBeNull();
    expect(decodeHash('!!!notlz!!!')).toBeNull();
  });

  it('backfills Cone.attachedPlayerId on a strat saved before it existed', () => {
    // A legacy cone object without attachedPlayerId.
    const legacy = JSON.stringify({
      v: 2, map: 'miru', notes: '',
      view: { zoom: 1, panX: 0, panY: 0 },
      activeFrame: 0,
      frames: [{
        strokes: [], shapes: [], players: [], textboxes: [], quickadds: [], scanner: null,
        cones: [{ id: 'c1', x: 10, y: 20, angle: 0, length: 130, spreadIdx: 1, customHalfAngle: null, color: '#00ff88' }],
      }],
    });
    const out = deserialize(legacy);
    expect(out.frames[0]!.cones[0]!.attachedPlayerId).toBeNull();
  });

  it('keeps a valid positive durationMs through serialize/deserialize', () => {
    const f = makeStratFile();
    f.frames[0]!.durationMs = 2000;
    const out = deserialize(serialize(f));
    expect(out.frames[0]!.durationMs).toBe(2000);
  });

  it('drops a non-positive or non-finite durationMs on load', () => {
    const f = makeStratFile();
    (f.frames[0] as { durationMs?: unknown }).durationMs = -5;
    expect(deserialize(serialize(f)).frames[0]!.durationMs).toBeUndefined();
    const g = makeStratFile();
    (g.frames[0] as { durationMs?: unknown }).durationMs = 'x';
    expect(deserialize(serialize(g)).frames[0]!.durationMs).toBeUndefined();
  });

  it('leaves durationMs unset on old saves', () => {
    const f = makeStratFile();
    expect(deserialize(serialize(f)).frames[0]!.durationMs).toBeUndefined();
  });

  it('keeps a non-empty caption through serialize/deserialize', () => {
    const f = makeStratFile();
    f.frames[0]!.caption = 'rotate to A site';
    const out = deserialize(serialize(f));
    expect(out.frames[0]!.caption).toBe('rotate to A site');
  });

  it('drops empty / non-string captions on load', () => {
    const a = makeStratFile();
    (a.frames[0] as { caption?: unknown }).caption = '';
    expect(deserialize(serialize(a)).frames[0]!.caption).toBeUndefined();

    const b = makeStratFile();
    (b.frames[0] as { caption?: unknown }).caption = 42;
    expect(deserialize(serialize(b)).frames[0]!.caption).toBeUndefined();

    const c = makeStratFile();
    (c.frames[0] as { caption?: unknown }).caption = null;
    expect(deserialize(serialize(c)).frames[0]!.caption).toBeUndefined();
  });

  it('caps a malicious oversized caption at 200 chars', () => {
    const f = makeStratFile();
    f.frames[0]!.caption = 'x'.repeat(10_000);
    const out = deserialize(serialize(f));
    expect(out.frames[0]!.caption!.length).toBe(200);
  });

  it('leaves caption unset on old saves (back-compat)', () => {
    const f = makeStratFile();
    expect(deserialize(serialize(f)).frames[0]!.caption).toBeUndefined();
  });

  it('preserves an explicit Cone.attachedPlayerId through a round trip', () => {
    const file: StratFile = {
      v: 2, map: 'miru', notes: '',
      view: { zoom: 1, panX: 0, panY: 0 },
      activeFrame: 0,
      frames: [{
        ...emptyFrame(),
        cones: [{ id: 'c1', x: 10, y: 20, angle: 0, length: 130, spreadIdx: 1, customHalfAngle: null, color: '#00ff88' as import('../types/hex').Hex, attachedPlayerId: 'p7' }],
      }],
    };
    expect(deserialize(serialize(file)).frames[0]!.cones[0]!.attachedPlayerId).toBe('p7');
  });
});

describe('writeStratToFile', () => {
  it('triggers an anchor-click download with the supplied filename', () => {
    // jsdom 24 lacks URL.createObjectURL/revokeObjectURL - stub them.
    if (typeof URL.createObjectURL !== 'function') {
      (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = (): string => 'blob:mock';
    }
    if (typeof URL.revokeObjectURL !== 'function') {
      (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = (): void => {};
    }
    const file: StratFile = {
      v: 2, map: 'miru', notes: '',
      view: { zoom: 1, panX: 0, panY: 0 },
      frames: [emptyFrame()], activeFrame: 0,
    };
    const created: HTMLAnchorElement[] = [];
    const orig = document.createElement.bind(document);
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = orig(tag);
      if (tag === 'a') {
        created.push(el as HTMLAnchorElement);
        (el as HTMLAnchorElement).click = vi.fn();
      }
      return el;
    });
    writeStratToFile(file, 'sample.strat.json');
    expect(created.length).toBe(1);
    expect(created[0]!.download).toBe('sample.strat.json');
    expect(created[0]!.click).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('readStratFromFile', () => {
  it('resolves a parsed StratFile when the file is valid JSON', async () => {
    const file: StratFile = {
      v: 2, map: 'suna', notes: 'hi',
      view: { zoom: 2, panX: 100, panY: -50 },
      frames: [emptyFrame()], activeFrame: 0,
    };
    const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
    const f = new File([blob], 'in.strat.json', { type: 'application/json' });
    const out = await readStratFromFile(f);
    expect(out.map).toBe('suna');
    expect(out.notes).toBe('hi');
  });

  it('rejects on unparseable JSON', async () => {
    const f = new File(['not json'], 'in.json');
    await expect(readStratFromFile(f)).rejects.toThrow();
  });

  it('rejects when JSON is parseable but not a StratFile', async () => {
    const f = new File([JSON.stringify({ hello: 'world' })], 'in.json');
    await expect(readStratFromFile(f)).rejects.toThrow();
  });
});
