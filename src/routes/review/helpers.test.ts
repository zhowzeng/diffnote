import { describe, expect, it } from 'vitest';
import {
  adjacentChangedFile,
  fileAfterReload,
  formatForAgent,
  formatQueueForAgent,
  inlineDiff,
  pruneByName,
  pruneToChanged,
} from './helpers';
import type { TreeNode } from './types';

const file = (name: string, changes?: { add: number; del: number }): TreeNode => ({
  type: 'file',
  name,
  path: name,
  changes,
  renamedFrom: null,
});
const dir = (name: string, children: TreeNode[]): TreeNode => ({
  type: 'dir',
  name,
  path: name,
  children,
});

describe('pruneToChanged', () => {
  it('keeps only files that changed, and the dirs leading to them', () => {
    const tree = [
      dir('src', [
        dir('routes', [file('+page.svelte', { add: 3, del: 1 }), file('types.ts')]),
        dir('lib', [file('untouched.ts')]),
      ]),
      file('README.md'),
    ];
    expect(pruneToChanged(tree)).toEqual([
      dir('src', [dir('routes', [file('+page.svelte', { add: 3, del: 1 })])]),
    ]);
  });

  it('leaves the tree it was given alone', () => {
    const tree = [dir('src', [file('a.ts', { add: 1, del: 0 }), file('b.ts')])];
    pruneToChanged(tree);
    expect(tree[0].type === 'dir' && tree[0].children).toHaveLength(2);
  });
});

describe('fileAfterReload', () => {
  const tree = [
    dir('src', [file('a.ts', { add: 1, del: 0 }), file('b.ts', { add: 2, del: 0 })]),
    file('README.md'),
  ];

  it('keeps the reviewer on the file they were reading', () => {
    expect(fileAfterReload(tree, 'b.ts')).toBe('b.ts');
  });

  it('keeps it even when the agent reverted it and it has no changes left', () => {
    expect(fileAfterReload([file('a.ts'), file('b.ts', { add: 1, del: 0 })], 'a.ts')).toBe('a.ts');
  });

  it('falls back to the first changed file once that file is gone from the tree', () => {
    expect(fileAfterReload(tree, 'deleted.ts')).toBe('a.ts');
  });

  it('opens on the first changed file, not the first file, with nothing to keep', () => {
    expect(fileAfterReload(tree, null)).toBe('a.ts');
  });

  it('has nothing to open when the tree has no changed file left', () => {
    expect(fileAfterReload([file('README.md')], 'deleted.ts')).toBeNull();
  });
});

describe('adjacentChangedFile', () => {
  const tree = [
    dir('src', [file('a.ts', { add: 1, del: 0 }), file('b.ts'), file('c.ts', { add: 2, del: 0 })]),
    file('d.ts', { add: 1, del: 1 }),
  ];

  it('moves through changed files in sidebar order, skipping unchanged ones', () => {
    expect(adjacentChangedFile(tree, 'a.ts', 1)).toBe('c.ts');
    expect(adjacentChangedFile(tree, 'c.ts', 1)).toBe('d.ts');
    expect(adjacentChangedFile(tree, 'c.ts', -1)).toBe('a.ts');
  });

  it('stops at either end instead of wrapping', () => {
    expect(adjacentChangedFile(tree, 'd.ts', 1)).toBeNull();
    expect(adjacentChangedFile(tree, 'a.ts', -1)).toBeNull();
  });

  it('starts from the end it is heading away from when no changed file is open', () => {
    expect(adjacentChangedFile(tree, null, 1)).toBe('a.ts');
    expect(adjacentChangedFile(tree, null, -1)).toBe('d.ts');
    expect(adjacentChangedFile(tree, 'b.ts', 1)).toBe('a.ts');
  });

  it('has nowhere to go without changed files', () => {
    expect(adjacentChangedFile([file('README.md')], null, 1)).toBeNull();
  });
});

describe('pruneByName', () => {
  it('matches file names case-insensitively and keeps the dirs above them', () => {
    const tree = [dir('src', [dir('routes', [file('Topbar.svelte'), file('state.svelte.ts')])])];
    expect(pruneByName(tree, 'topbar')).toEqual([dir('src', [dir('routes', [file('Topbar.svelte')])])]);
  });

  it('drops a dir whose name matches but whose files do not', () => {
    const tree = [dir('review', [file('a.ts')])];
    expect(pruneByName(tree, 'review')).toEqual([]);
  });
});

describe('formatQueueForAgent', () => {
  const items = [
    { file: 'src/a.ts', lineStart: 3, text: 'rename this' },
    { file: 'src/b.ts', lineStart: 10, lineEnd: 12, text: 'extract a helper' },
  ];

  it('joins every comment in the queue with a blank line between them', () => {
    expect(formatQueueForAgent(items)).toBe(
      'src/a.ts:L3\nrename this\n\nsrc/b.ts:L10-L12\nextract a helper'
    );
  });

  it('puts the prefix in front once, not once per comment', () => {
    expect(formatQueueForAgent(items, 'Apply these:')).toBe(
      'Apply these:\n\nsrc/a.ts:L3\nrename this\n\nsrc/b.ts:L10-L12\nextract a helper'
    );
  });

  it('leaves out the prefix when there is none', () => {
    expect(formatQueueForAgent([items[0]], '')).toBe('src/a.ts:L3\nrename this');
  });
});

describe('formatForAgent', () => {
  const orphaned = {
    file: 'src/foo.rs',
    lineStart: 12,
    text: '這裡應該用 open_workbook_auto',
    orphaned: { anchorText: ['let x = foo()?;'], staged: false },
  };

  it('quotes the lines instead of a line number once they are gone', () => {
    expect(formatForAgent(orphaned)).toBe(
      'src/foo.rs (commented at L12; that code is no longer in the file)\n' +
        '> let x = foo()?;\n這裡應該用 open_workbook_auto'
    );
  });

  it('says the working tree moved when the comment was written against the index', () => {
    expect(formatForAgent({ ...orphaned, orphaned: { ...orphaned.orphaned, staged: true } })).toBe(
      'src/foo.rs (commented at L12 as staged; the working tree has since changed)\n' +
        '> let x = foo()?;\n這裡應該用 open_workbook_auto'
    );
  });

  it('prefixes every quoted line, so a multi-line comment stays apart from the code', () => {
    const text = formatForAgent({
      ...orphaned,
      lineEnd: 13,
      text: 'first line\nsecond line',
      orphaned: { anchorText: ['let x = foo()?;', 'let y = bar()?;'], staged: false },
    });
    expect(text).toBe(
      'src/foo.rs (commented at L12-L13; that code is no longer in the file)\n' +
        '> let x = foo()?;\n> let y = bar()?;\nfirst line\nsecond line'
    );
  });
});

const marked = (segs: { text: string; changed: boolean }[]) => segs.filter((s) => s.changed).map((s) => s.text);

describe('inlineDiff', () => {
  it('marks only the words that changed on each side', () => {
    const diff = inlineDiff('const x = foo(bar);', 'const x = foo(baz);');
    expect(diff && marked(diff.old)).toEqual(['bar']);
    expect(diff && marked(diff.new)).toEqual(['baz']);
  });

  it('keeps the whole line text across its segments', () => {
    const diff = inlineDiff('a b c', 'a x c');
    expect(diff?.old.map((s) => s.text).join('')).toBe('a b c');
    expect(diff?.new.map((s) => s.text).join('')).toBe('a x c');
  });

  it('marks the space between two changed words with them', () => {
    const diff = inlineDiff('available: list existing files', 'available: only the files');
    expect(diff && marked(diff.new)).toEqual(['only the']);
  });

  it('lines up a word with its own copy, not a later one that shares only whitespace', () => {
    const diff = inlineDiff('overwrite in input_files. Read', 'listed in input_files are copied in. Read');
    expect(diff && marked(diff.old)).toEqual(['overwrite']);
    expect(diff && marked(diff.new)).toEqual(['listed', 'are copied in']);
  });

  it('marks nothing when the lines share no word', () => {
    expect(inlineDiff('alpha beta', 'gamma delta')).toBeNull();
  });
});
