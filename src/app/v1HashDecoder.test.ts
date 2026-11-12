import { describe, it, expect } from 'vitest';
import LZString from 'lz-string';
import { decodeV1Hash, tryDecodeV1Text } from './v1HashDecoder';

function lzCode(prefix: 'L' | 'A', packed: unknown): string {
  return prefix + LZString.compressToEncodedURIComponent(JSON.stringify(packed));
}
function v1HashFromV4Packed(packed: unknown[]): string {
  return lzCode('L', packed);
}
function v1HashFromV3Packed(packed: unknown[]): string {
  return lzCode('L', packed);
}

describe('decodeV1Hash', () => {
  it('returns null for empty input', () => {
    expect(decodeV1Hash('')).toBeNull();
  });

  it('returns null when no L or A prefix', () => {
    expect(decodeV1Hash('Xnotalegalprefix')).toBeNull();
  });

  it('returns null for malformed LZ payload', () => {
    expect(decodeV1Hash('L!!!not-lz!!!')).toBeNull();
  });

  it('returns null when version not 3 or 4', () => {
    const hash = v1HashFromV4Packed([99, 'miru', [], [], [], null, [], [], [], '', 0]);
    expect(decodeV1Hash(hash)).toBeNull();
  });

  it('migrates every layer of a v4 board', () => {
    const players = [
      ['p2', 'reyab', 300, 300, 1, 1, 'Bravo'],
      ['p1', 'colonist', 100, 200, 0, 0, 'Alpha'],
    ];
    const cones = [
      ['c1', 50, 50, 0, 100, 1, null, null],   // free cone
      ['c2', 60, 60, 1, 120, 2, null, 'p1'],   // attached to p1
    ];
    const tb = [['t1', 10, 10, 80, 30, 'note', 18]];
    const sc = [60, 70];
    const strokes = [
      ['s1', 0, '#00ff88', 1, 2, [[10, 20], [11, 21]]],
      ['s2', 1, '#ff4655', 0.5, 4, [[30, 40]]],
    ];
    const shapes = [['sh1', 'square', 100, 100, 80, 80, 0, '#00ff88', 2, 0]];
    const qa = [['q1', 'grenade', 100, 100]];
    const hash = v1HashFromV4Packed([4, 'khidi', players, cones, tb, sc, strokes, shapes, qa, 'Hi from v1', 0]);

    const result = decodeV1Hash(hash);
    expect(result).not.toBeNull();
    expect(result!.file.map).toBe('khidi');
    expect(result!.file.notes).toBe('Hi from v1');
    expect(result!.file.frames.length).toBe(1);
    const frame = result!.file.frames[0]!;

    // players sorted by their stored order (Alpha order 0 before Bravo order 1)
    expect(frame.players.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(frame.players[0]).toMatchObject({ id: 'p1', team: 'colonist', x: 100, y: 200, name: 'Alpha', dead: false });
    expect(frame.players[1]).toMatchObject({ id: 'p2', team: 'reyab', dead: true });

    // cones: free cone gets the neutral grey + no attachment, attached keeps it
    expect(frame.cones.length).toBe(2);
    expect(frame.cones[0]).toMatchObject({ id: 'c1', attachedPlayerId: null, color: '#aeb6bb', spreadIdx: 1 });
    expect(frame.cones[1]).toMatchObject({ id: 'c2', attachedPlayerId: 'p1', color: null, spreadIdx: 2 });

    // textbox: white default colour, font carried over
    expect(frame.textboxes[0]).toMatchObject({ id: 't1', text: 'note', fontSize: 18, color: '#ffffff' });

    expect(frame.scanner).toEqual({ x: 60, y: 70 });

    expect(frame.strokes.length).toBe(2);
    expect(frame.strokes[0]).toMatchObject({ id: 's1', type: 'draw', color: '#00ff88' });
    expect(frame.strokes[1]).toMatchObject({ id: 's2', type: 'erase' });

    // square: v1 centre 100,100 size 80 -> v2 top-left 60,60
    expect(frame.shapes[0]).toMatchObject({ id: 'sh1', kind: 'square', x: 60, y: 60, w: 80, h: 80, rotation: 0 });

    expect(frame.quickadds[0]).toMatchObject({ id: 'q1', type: 'grenade', x: 100, y: 100, rangeVisible: false });

    expect(result!.droppedKinds).toEqual([]);
  });

  it('bakes line/arrow rotation into the endpoints', () => {
    // a line centred at (100,100), length 80, rotated 90 degrees
    const shapes = [['l1', 'line', 100, 100, 80, 0, 90, '#ff0000', 3, 0]];
    const hash = v1HashFromV4Packed([4, 'suna', [], [], [], null, [], shapes, [], '', 0]);
    const line = decodeV1Hash(hash)!.file.frames[0]!.shapes[0]!;
    expect(line.kind).toBe('line');
    expect(line.rotation).toBe(0);
    // rotated 90 deg: the 80-long segment now runs vertically through (100,100)
    expect(line.x).toBeCloseTo(100, 5);
    expect(line.y).toBeCloseTo(60, 5);
    expect(line.w).toBeCloseTo(0, 5);
    expect(line.h).toBeCloseTo(80, 5);
  });

  it('decodes v3 packed (no shapes/quickadds, empty notes)', () => {
    const strokes = [['s1', 0, '#00ff88', 1, 2, [[10, 20]]]];
    const players = [['p1', 'colonist', 0, 0, 0, 0, 'A']];
    const hash = v1HashFromV3Packed([3, 'suna', players, [], [], null, strokes]);
    const result = decodeV1Hash(hash);
    expect(result).not.toBeNull();
    expect(result!.file.map).toBe('suna');
    expect(result!.file.notes).toBe('');
    const frame = result!.file.frames[0]!;
    expect(frame.strokes.length).toBe(1);
    expect(frame.players.length).toBe(1);
    expect(frame.shapes).toEqual([]);
    expect(frame.quickadds).toEqual([]);
    expect(result!.droppedKinds).toEqual([]);
  });

  it('falls back to suna when the v1 map is unknown', () => {
    const hash = v1HashFromV4Packed([4, 'UNKNOWN_MAP', [], [], [], null, [], [], [], '', 0]);
    expect(decodeV1Hash(hash)!.file.map).toBe('suna');
  });

  it('decodes a v1 animation into one frame per board', () => {
    const board = (n: number): unknown[] => [
      4, 'miru', [['p1', 'colonist', n, n, 0, 0, '']], [], [], null, [], [], [], '', 0,
    ];
    const codes = [lzCode('L', board(1)), lzCode('L', board(2)), lzCode('L', board(3))];
    const animHash = lzCode('A', ['A1', 2, codes]);
    const result = decodeV1Hash(animHash);
    expect(result).not.toBeNull();
    expect(result!.file.map).toBe('miru');
    expect(result!.file.frames.length).toBe(3);
    expect(result!.file.activeFrame).toBe(2);
    expect(result!.file.frames[0]!.players[0]!.x).toBe(1);
    expect(result!.file.frames[2]!.players[0]!.x).toBe(3);
  });

  it('reports a layer as dropped only when the source had items but none survived', () => {
    // one player with a bad team -> players present in source but 0 migrate.
    const hash = v1HashFromV4Packed([
      4, 'miru', [['p1', 'notateam', 0, 0, 0, 0, '']], [], [], null, [], [], [], '', 0,
    ]);
    expect(decodeV1Hash(hash)!.droppedKinds).toEqual(['players']);
  });
});

describe('tryDecodeV1Text', () => {
  it('accepts a raw v1 code with no leading hash', () => {
    const code = lzCode('L', [4, 'suna', [], [], [], null, [], [], [], 'notes', 0]);
    expect(tryDecodeV1Text(code)!.file.notes).toBe('notes');
  });

  it('accepts a v1 code with a leading #', () => {
    const code = '#' + lzCode('L', [3, 'frio', [], [], [], null, []]);
    expect(tryDecodeV1Text(code)!.file.map).toBe('frio');
  });

  it('accepts the raw packed array as JSON', () => {
    const json = JSON.stringify([4, 'cliffside', [], [], [], null, [], [], [], 'raw', 0]);
    const result = tryDecodeV1Text(json);
    expect(result!.file.map).toBe('cliffside');
    expect(result!.file.notes).toBe('raw');
  });

  it('returns null for unrelated text', () => {
    expect(tryDecodeV1Text('just some words')).toBeNull();
    expect(tryDecodeV1Text('')).toBeNull();
  });
});
