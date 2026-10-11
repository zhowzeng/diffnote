import { describe, expect, it } from 'vitest';
import { diffLines, fileViewLines, type SplitRow } from './lines';
import type { DiffHunk, DiffLine } from './types';

const ctx = (oldNo: number, newNo: number, content = 'ctx'): DiffLine => ({ kind: 'context', oldNo, newNo, content });
const del = (oldNo: number, content = 'del'): DiffLine => ({ kind: 'del', oldNo, newNo: null, content });
const add = (newNo: number, content = 'add'): DiffLine => ({ kind: 'add', oldNo: null, newNo, content });

const hunk = (lines: DiffLine[], header = '@@'): DiffHunk => ({ header, lines });

const NONE = new Set<number>();

/** The line rows of Split view, without the hunk headers. */
const pairs = (hunks: DiffHunk[]) =>
  diffLines(hunks)
    .splitRows(NONE)
    .filter((r): r is SplitRow & { kind: 'row' } => r.kind === 'row');

const marked = (segs?: { text: string; changed: boolean }[]) => segs?.filter((s) => s.changed).map((s) => s.text);

describe('anchorFor', () => {
  it('drops lineEnd for a single-line selection', () => {
    const { anchor } = diffLines([hunk([ctx(10, 12)])]).anchorFor(0, 0);
    expect(anchor).toEqual({ lineStart: 12, lineEnd: undefined, side: 'new' });
  });

  it('reads both ends off the new side, so a swept del cannot reverse the range', () => {
    // ctx 12 / del (old side only) / add 13 — the del has no new-side number to read.
    const { anchor } = diffLines([hunk([ctx(11, 12), del(12), add(13)])]).anchorFor(0, 2);
    expect(anchor).toEqual({ lineStart: 12, lineEnd: 13, side: 'new' });
  });

  it('drops lineEnd when the swept lines all land on one new-side number', () => {
    const { anchor } = diffLines([hunk([add(13), del(12), del(13)])]).anchorFor(0, 2);
    expect(anchor).toEqual({ lineStart: 13, lineEnd: undefined, side: 'new' });
  });

  it('carries exactly the lines it numbers, leaving out a swept del', () => {
    const lines = diffLines([hunk([ctx(11, 12, 'a'), del(12, 'gone'), add(13, 'b')])]);
    const { anchor, anchorText } = lines.anchorFor(0, 2);
    expect(anchorText).toEqual(['a', 'b']);
    expect(anchorText).toHaveLength(anchor.lineEnd! - anchor.lineStart + 1);
  });

  it('counts across hunks by idx', () => {
    const lines = diffLines([hunk([ctx(1, 1), add(2)]), hunk([ctx(40, 41, 'far')])]);
    expect(lines.anchorFor(2, 2)).toEqual({
      anchor: { lineStart: 41, lineEnd: undefined, side: 'new' },
      anchorText: ['far'],
    });
  });

  it('numbers File View lines from 1 off the file itself', () => {
    expect(fileViewLines(['a', 'b', 'c']).anchorFor(1, 2)).toEqual({
      anchor: { lineStart: 2, lineEnd: 3, side: 'file' },
      anchorText: ['b', 'c'],
    });
  });
});

describe('canExtend', () => {
  it('keeps a drag inside the hunk it started in', () => {
    const lines = diffLines([hunk([ctx(1, 1), add(2)]), hunk([ctx(40, 41)])]);
    expect(lines.canExtend(0, 1)).toBe(true);
    expect(lines.canExtend(0, 2)).toBe(false);
    expect(lines.hunkOf(2)).toBe(1);
  });

  it('lets a File View drag run anywhere in the file', () => {
    expect(fileViewLines(['a', 'b', 'c']).canExtend(0, 2)).toBe(true);
  });
});

describe('isCommented', () => {
  it('looks a diff line up by its new-side number, and never marks a del', () => {
    const lines = diffLines([hunk([ctx(4, 5), del(5), add(6)])]);
    const keys = new Set(['new:5', 'new:6', 'old:5']);
    expect([0, 1, 2].map((i) => lines.isCommented(i, keys))).toEqual([true, false, true]);
  });

  it('looks a File View line up by its line number', () => {
    const lines = fileViewLines(['a', 'b']);
    expect([0, 1].map((i) => lines.isCommented(i, new Set(['file:2'])))).toEqual([false, true]);
  });

  it('does not mix up the diff and File View numbering spaces', () => {
    expect(diffLines([hunk([add(1)])]).isCommented(0, new Set(['file:1']))).toBe(false);
    expect(fileViewLines(['a']).isCommented(0, new Set(['new:1']))).toBe(false);
  });
});

describe('splitRows', () => {
  it('puts a context line on both sides, commentable only on the right', () => {
    const [row] = pairs([hunk([ctx(10, 12)])]);
    expect(row.left).toEqual({ kind: 'context', no: 10, text: 'ctx', idx: 0 });
    expect(row.right).toEqual({ kind: 'context', no: 12, text: 'ctx', idx: 0, commentable: true });
  });

  it('pairs a del run with the add run that follows it', () => {
    const rows = pairs([hunk([del(5), del(6), add(5), add(6)])]);
    expect(rows.map((r) => [r.left?.no, r.right?.no])).toEqual([
      [5, 5],
      [6, 6],
    ]);
  });

  it('leaves the right side empty for the dels a shorter add run cannot cover', () => {
    const rows = pairs([hunk([del(5), del(6), del(7), add(5)])]);
    expect(rows.map((r) => [r.left?.no, r.right?.no ?? null])).toEqual([
      [5, 5],
      [6, null],
      [7, null],
    ]);
  });

  it('leaves the left side empty for the adds a shorter del run cannot cover', () => {
    const rows = pairs([hunk([del(5), add(5), add(6), add(7)])]);
    expect(rows.map((r) => [r.left?.no ?? null, r.right?.no])).toEqual([
      [5, 5],
      [null, 6],
      [null, 7],
    ]);
  });

  it('starts a new pairing when adds come before dels', () => {
    const rows = pairs([hunk([add(1), del(1)])]);
    expect(rows.map((r) => [r.left?.kind ?? null, r.right?.kind ?? null])).toEqual([
      [null, 'add'],
      ['del', null],
    ]);
  });

  it('keeps the flat idx of every line it pairs, across hunks', () => {
    const rows = pairs([hunk([ctx(1, 1), del(2), add(2)]), hunk([ctx(9, 9)])]);
    expect(rows.flatMap((r) => [r.left?.idx, r.right?.idx].filter((i) => i !== undefined))).toEqual([
      0, 0, 1, 2, 3, 3,
    ]);
  });
});

describe('rows', () => {
  it('keeps a collapsed hunk header and leaves out its lines, in both views', () => {
    const lines = diffLines([hunk([add(1)], '@@ a'), hunk([add(9)], '@@ b')]);
    const collapsed = new Set([0]);
    expect(lines.unifiedRows(collapsed).map((r) => (r.kind === 'header' ? r.label : r.idx))).toEqual(['@@ a', '@@ b', 1]);
    expect(lines.splitRows(collapsed).map((r) => (r.kind === 'header' ? r.label : r.right?.idx))).toEqual(['@@ a', '@@ b', 1]);
  });

  it('marks what changed within the n-th del of a run against the n-th add after it', () => {
    const lines = diffLines([hunk([ctx(1, 1), del(2, 'let a = 1;'), del(3, 'x'), add(2, 'let a = 2;')])]);
    const unified = lines.unifiedRows(NONE).flatMap((r) => (r.kind === 'line' ? [marked(r.segments)] : []));
    // The unpaired del and the context line have nothing to compare against.
    expect(unified).toEqual([undefined, ['1'], undefined, ['2']]);
    const [, first] = pairs([hunk([ctx(1, 1), del(2, 'let a = 1;'), del(3, 'x'), add(2, 'let a = 2;')])]);
    expect([marked(first.left?.segments), marked(first.right?.segments)]).toEqual([['1'], ['2']]);
  });
});
