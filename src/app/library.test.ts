import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  INDEX_KEY,
  INDEX_BACKUP_KEY,
  entryKey,
  getIndex,
  saveStrat,
  loadStrat,
  listStrats,
  deleteStrat,
  renameStrat,
  duplicateStrat,
  normalizeTags,
  parseTagsInput,
  LibraryError,
  type LibraryEntry,
} from './library';
import type { StratFile } from '../types/stratFile';
import { emptyFrame } from '../types/primitives';

function makeStratFile(): StratFile {
  return {
    v: 2,
    map: 'miru',
    notes: '',
    view: { zoom: 1, panX: 0, panY: 0 },
    frames: [emptyFrame()],
    activeFrame: 0,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('library - index + saveStrat', () => {
  it('getIndex returns empty array on first run', () => {
    expect(getIndex()).toEqual([]);
  });

  it('getIndex returns empty array when storage access throws (blocked site data)', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    try {
      expect(getIndex()).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it('a save over a damaged index backs the old text up first, and keeps the first backup', () => {
    localStorage.setItem(INDEX_KEY, 'not json');
    saveStrat({ name: 'A', file: makeStratFile(), thumbDataUrl: 'data:image/png;base64,A' });
    expect(localStorage.getItem(INDEX_BACKUP_KEY)).toBe('not json');
    expect(getIndex()).toHaveLength(1);

    localStorage.setItem(INDEX_KEY, '[{"broken":true}]');
    saveStrat({ name: 'B', file: makeStratFile(), thumbDataUrl: 'data:image/png;base64,B' });
    expect(localStorage.getItem(INDEX_BACKUP_KEY)).toBe('not json');
  });

  it('deleteStrat keeps the blob when the index write fails, so the row still loads', () => {
    const id = saveStrat({ name: 'A', file: makeStratFile(), thumbDataUrl: 'data:image/png;base64,A' });
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    try {
      expect(() => deleteStrat(id)).toThrow();
    } finally {
      spy.mockRestore();
    }
    expect(() => loadStrat(id)).not.toThrow();
  });

  it('a save over a healthy index makes no backup', () => {
    saveStrat({ name: 'A', file: makeStratFile(), thumbDataUrl: 'data:image/png;base64,A' });
    saveStrat({ name: 'B', file: makeStratFile(), thumbDataUrl: 'data:image/png;base64,B' });
    expect(localStorage.getItem(INDEX_BACKUP_KEY)).toBeNull();
  });

  it('getIndex returns empty array when index key holds invalid JSON', () => {
    localStorage.setItem(INDEX_KEY, 'not json');
    expect(getIndex()).toEqual([]);
  });

  it('saveStrat writes the entry blob and appends to the index', () => {
    const file = makeStratFile();
    const id = saveStrat({ name: 'Alpha', file, thumbDataUrl: 'data:image/png;base64,A' });
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);

    const blob = localStorage.getItem(entryKey(id));
    expect(blob).not.toBeNull();
    const parsed = JSON.parse(blob!) as StratFile;
    expect(parsed.map).toBe('miru');

    const idx = getIndex();
    expect(idx.length).toBe(1);
    expect(idx[0]!.id).toBe(id);
    expect(idx[0]!.name).toBe('Alpha');
    expect(idx[0]!.mapId).toBe('miru');
    expect(idx[0]!.thumbDataUrl).toBe('data:image/png;base64,A');
    expect(typeof idx[0]!.updatedAt).toBe('number');
  });

  it('saveStrat returns distinct ids for separate calls', () => {
    const a = saveStrat({ name: 'A', file: makeStratFile(), thumbDataUrl: 'data:image/png;base64,A' });
    const b = saveStrat({ name: 'B', file: makeStratFile(), thumbDataUrl: 'data:image/png;base64,B' });
    expect(a).not.toBe(b);
    expect(getIndex().length).toBe(2);
  });

  it('saveStrat with explicit id overwrites the existing entry and updates index in place', () => {
    const id = saveStrat({ name: 'Alpha', file: makeStratFile(), thumbDataUrl: 'data:image/png;base64,A' });
    const file2: StratFile = { ...makeStratFile(), map: 'suna' };
    const id2 = saveStrat({ id, name: 'Alpha v2', file: file2, thumbDataUrl: 'data:image/png;base64,B' });
    expect(id2).toBe(id);
    const idx = getIndex();
    expect(idx.length).toBe(1);
    expect(idx[0]!.name).toBe('Alpha v2');
    expect(idx[0]!.mapId).toBe('suna');
    expect(idx[0]!.thumbDataUrl).toBe('data:image/png;base64,B');
  });

  it('saveStrat throws LibraryError("QUOTA_EXCEEDED") when localStorage quota is exhausted', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      const e = new Error('quota') as Error & { name: string };
      e.name = 'QuotaExceededError';
      throw e;
    });
    expect(() =>
      saveStrat({ name: 'A', file: makeStratFile(), thumbDataUrl: 'data:image/png;base64,A' }),
    ).toThrow(LibraryError);
    spy.mockRestore();
  });

  it('saveStrat rolls back the entry blob when the index write fails (no orphan blob)', () => {
    // Real setItem for the entry blob; mock only the index write to throw.
    const realSet = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (k === INDEX_KEY) {
        const e = new Error('quota') as Error & { name: string };
        e.name = 'QuotaExceededError';
        throw e;
      }
      realSet.call(this, k, v);
    });
    let thrownId: string | undefined;
    try {
      thrownId = saveStrat({ name: 'A', file: makeStratFile(), thumbDataUrl: 'data:image/png;base64,A' });
    } catch { /* expected */ }
    spy.mockRestore();
    expect(thrownId).toBeUndefined();
    expect(getIndex()).toEqual([]);
    // Walk every localStorage key - none should be a library entry blob.
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      expect(k.startsWith('artifact-gg.v2.library.') && k !== INDEX_KEY).toBe(false);
    }
  });

  it('saveStrat overwriting an existing entry does NOT remove the blob when the index write fails', () => {
    // Overwrite path: the old blob was clobbered by the entry write, so removing
    // it on rollback would also strand the surviving index row's loadStrat.
    const id = saveStrat({ name: 'Alpha', file: makeStratFile(), thumbDataUrl: 'data:image/png;base64,A' });
    const realSet = Storage.prototype.setItem;
    let indexWrites = 0;
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (k === INDEX_KEY) {
        indexWrites++;
        // Only fail the SECOND index write (the one inside our test, not the one
        // that already happened during the first saveStrat above).
        if (indexWrites >= 1) {
          const e = new Error('quota') as Error & { name: string };
          e.name = 'QuotaExceededError';
          throw e;
        }
      }
      realSet.call(this, k, v);
    });
    try {
      saveStrat({ id, name: 'Alpha v2', file: makeStratFile(), thumbDataUrl: 'data:image/png;base64,B' });
    } catch { /* expected */ }
    spy.mockRestore();
    // The blob is still there (now holding the new bytes) so the old index row
    // is still readable, even if its name/thumb is stale.
    expect(localStorage.getItem(entryKey(id))).not.toBeNull();
  });

  it('LibraryEntry shape', () => {
    const e: LibraryEntry = {
      id: 'x',
      name: 'X',
      mapId: 'miru',
      updatedAt: 1,
      thumbDataUrl: 'data:image/png;base64,X',
    };
    expect(e.id).toBe('x');
  });
});

describe('library - load / list / delete / rename / duplicate', () => {
  it('loadStrat returns the StratFile for an existing id', () => {
    const id = saveStrat({ name: 'Alpha', file: makeStratFile(), thumbDataUrl: 'data:image/png;base64,A' });
    const loaded = loadStrat(id);
    expect(loaded.map).toBe('miru');
    expect(loaded.v).toBe(2);
  });

  it('loadStrat throws LibraryError("NOT_FOUND") when id is unknown', () => {
    expect(() => loadStrat('no-such-id')).toThrow(LibraryError);
  });

  it('loadStrat throws LibraryError("PARSE_FAILED") when blob is corrupt', () => {
    localStorage.setItem(entryKey('corrupt'), 'not json');
    // Inject a matching index entry so the function reaches the parse step.
    localStorage.setItem(INDEX_KEY, JSON.stringify([{ id: 'corrupt', name: 'X', mapId: 'miru', updatedAt: 1, thumbDataUrl: 'data:image/png;base64,X' }]));
    expect(() => loadStrat('corrupt')).toThrow(LibraryError);
  });

  it('listStrats returns the index, newest-first', () => {
    const a = saveStrat({ name: 'A', file: makeStratFile(), thumbDataUrl: 'data:image/png;base64,A' });
    // Wait one tick to ensure distinct timestamps.
    vi.useFakeTimers();
    vi.advanceTimersByTime(10);
    const b = saveStrat({ name: 'B', file: makeStratFile(), thumbDataUrl: 'data:image/png;base64,B' });
    vi.useRealTimers();
    const list = listStrats();
    expect(list[0]!.id).toBe(b);
    expect(list[1]!.id).toBe(a);
  });

  it('deleteStrat removes the entry blob and index row', () => {
    const id = saveStrat({ name: 'A', file: makeStratFile(), thumbDataUrl: 'data:image/png;base64,A' });
    deleteStrat(id);
    expect(localStorage.getItem(entryKey(id))).toBeNull();
    expect(getIndex().find((e) => e.id === id)).toBeUndefined();
  });

  it('deleteStrat is a no-op when id is unknown', () => {
    expect(() => deleteStrat('no-such-id')).not.toThrow();
    expect(getIndex()).toEqual([]);
  });

  it('renameStrat updates the index name and updatedAt; does not touch the blob', () => {
    const id = saveStrat({ name: 'A', file: makeStratFile(), thumbDataUrl: 'data:image/png;base64,A' });
    const blobBefore = localStorage.getItem(entryKey(id));
    renameStrat(id, 'A renamed');
    const idx = getIndex();
    expect(idx[0]!.name).toBe('A renamed');
    expect(localStorage.getItem(entryKey(id))).toBe(blobBefore);
  });

  it('renameStrat throws LibraryError("NOT_FOUND") when id is unknown', () => {
    expect(() => renameStrat('no-such-id', 'X')).toThrow(LibraryError);
  });

  it('duplicateStrat creates a new entry with " (copy)" suffix and a fresh id', () => {
    const id = saveStrat({ name: 'Alpha', file: makeStratFile(), thumbDataUrl: 'data:image/png;base64,A' });
    const newId = duplicateStrat(id);
    expect(newId).not.toBe(id);
    const idx = getIndex();
    expect(idx.length).toBe(2);
    const copy = idx.find((e) => e.id === newId)!;
    expect(copy.name).toBe('Alpha (copy)');
    expect(copy.thumbDataUrl).toBe('data:image/png;base64,A');
    const dup = loadStrat(newId);
    expect(dup.map).toBe('miru');
  });

  it('duplicateStrat throws LibraryError("NOT_FOUND") when id is unknown', () => {
    expect(() => duplicateStrat('no-such-id')).toThrow(LibraryError);
  });
});

describe('library - tags', () => {
  it('normalizeTags trims, drops empties, de-dupes case-insensitively, and caps', () => {
    expect(normalizeTags(['  A ', 'a', '', 'b'])).toEqual(['A', 'b']);
    expect(normalizeTags(Array.from({ length: 20 }, (_, i) => `t${i}`)).length).toBe(12);
    expect(normalizeTags(['x'.repeat(40)])[0]!.length).toBe(24);
  });

  it('parseTagsInput splits on commas then normalizes', () => {
    expect(parseTagsInput('a, b ,,a')).toEqual(['a', 'b']);
  });

  it('saveStrat persists normalized tags; an untagged save stores no tags field', () => {
    const id = saveStrat({ name: 'A', file: makeStratFile(), thumbDataUrl: 'data:image/png;base64,A', tags: ['  X ', 'x'] });
    expect(getIndex().find((x) => x.id === id)!.tags).toEqual(['X']);
    const id2 = saveStrat({ name: 'B', file: makeStratFile(), thumbDataUrl: 'data:image/png;base64,B' });
    expect('tags' in getIndex().find((x) => x.id === id2)!).toBe(false);
  });

  it('renameStrat sets tags when given, leaves them when omitted, clears on empty', () => {
    const id = saveStrat({ name: 'A', file: makeStratFile(), thumbDataUrl: 'data:image/png;base64,A', tags: ['t'] });
    renameStrat(id, 'A2');
    expect(getIndex().find((x) => x.id === id)!.tags).toEqual(['t']);     // untouched
    renameStrat(id, 'A3', ['u', 'v']);
    expect(getIndex().find((x) => x.id === id)!.tags).toEqual(['u', 'v']); // set
    renameStrat(id, 'A4', []);
    expect('tags' in getIndex().find((x) => x.id === id)!).toBe(false);    // cleared
  });

  it('getIndex accepts rows with/without tags and drops malformed tags', () => {
    localStorage.setItem(INDEX_KEY, JSON.stringify([
      { id: '1', name: 'n', mapId: 'miru', updatedAt: 1, thumbDataUrl: 'data:image/png;base64,A' },
      { id: '2', name: 'n', mapId: 'miru', updatedAt: 1, thumbDataUrl: 'data:image/png;base64,A', tags: ['ok'] },
      { id: '3', name: 'n', mapId: 'miru', updatedAt: 1, thumbDataUrl: 'data:image/png;base64,A', tags: [1] },
      { id: '4', name: 'n', mapId: 'miru', updatedAt: 1, thumbDataUrl: 'data:image/png;base64,A', tags: 'x' },
    ]));
    expect(getIndex().map((e) => e.id)).toEqual(['1', '2']);
  });
});
