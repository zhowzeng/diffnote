// Settings come back out of the WebView's localStorage (docs/decisions/0006), which an
// older build or a hand edit may have left in any shape at all. sanitize() is the only
// thing between that and the UI, so these tests drive it through the same door the app
// does: write a raw value, load the module, see what the app gets.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'redline.settings';

const DEFAULTS = {
  theme: 'system',
  diffFontSize: 'md',
  defaultDiffMode: 'unstaged',
  lineWrap: false,
  usePrefixPrompt: false,
  prefixPrompt: '',
};

// Settings load once, when the module is first imported, so each test gets its own copy.
async function loadWith(raw: string | null) {
  localStorage.clear();
  if (raw !== null) localStorage.setItem(STORAGE_KEY, raw);
  vi.resetModules();
  return import('./state.svelte');
}

beforeEach(() => localStorage.clear());

describe('stored value that is not settings at all', () => {
  it('falls back to the defaults with nothing stored', async () => {
    const { settings } = await loadWith(null);
    expect({ ...settings }).toEqual(DEFAULTS);
  });

  it('falls back to the defaults on broken JSON', async () => {
    const { settings } = await loadWith('{"diffFontSize":');
    expect({ ...settings }).toEqual(DEFAULTS);
  });

  it('falls back to the defaults on a stored null', async () => {
    const { settings } = await loadWith('null');
    expect({ ...settings }).toEqual(DEFAULTS);
  });

  it('falls back to the defaults on a stored scalar', async () => {
    const { settings } = await loadWith('42');
    expect({ ...settings }).toEqual(DEFAULTS);
  });

  it('falls back to the defaults on a stored array', async () => {
    const { settings } = await loadWith('[]');
    expect({ ...settings }).toEqual(DEFAULTS);
  });
});

describe('stored value with bad fields', () => {
  it('replaces a theme this build does not have', async () => {
    const { settings } = await loadWith(JSON.stringify({ ...DEFAULTS, theme: 'sepia' }));
    expect(settings.theme).toBe('system');
  });

  it('replaces a diffFontSize this build does not have', async () => {
    const { settings } = await loadWith(JSON.stringify({ ...DEFAULTS, diffFontSize: 'xl' }));
    expect(settings.diffFontSize).toBe('md');
  });

  it('replaces a defaultDiffMode this build does not have', async () => {
    const { settings } = await loadWith(JSON.stringify({ ...DEFAULTS, defaultDiffMode: 'worktree' }));
    expect(settings.defaultDiffMode).toBe('unstaged');
  });

  it('replaces a lineWrap that is not a boolean', async () => {
    const { settings } = await loadWith(JSON.stringify({ ...DEFAULTS, lineWrap: 'yes' }));
    expect(settings.lineWrap).toBe(false);
  });

  it('replaces a prefixPrompt that is not a string', async () => {
    const { settings } = await loadWith(JSON.stringify({ ...DEFAULTS, prefixPrompt: 7 }));
    expect(settings.prefixPrompt).toBe('');
  });

  it('replaces a usePrefixPrompt that is not a boolean', async () => {
    const { settings } = await loadWith(JSON.stringify({ ...DEFAULTS, usePrefixPrompt: 'true' }));
    expect(settings.usePrefixPrompt).toBe(false);
  });

  it('keeps the good fields of a partly bad value', async () => {
    const { settings } = await loadWith(JSON.stringify({ diffFontSize: 'lg', prefixPrompt: null }));
    expect({ ...settings }).toEqual({ ...DEFAULTS, diffFontSize: 'lg' });
  });
});

describe('round trip', () => {
  it('keeps a value it wrote itself', async () => {
    const { settings, updateSettings } = await loadWith(null);
    updateSettings({ diffFontSize: 'sm', lineWrap: true, usePrefixPrompt: true, prefixPrompt: 'review this' });
    expect({ ...settings }).toEqual({
      theme: 'system',
      diffFontSize: 'sm',
      defaultDiffMode: 'unstaged',
      lineWrap: true,
      usePrefixPrompt: true,
      prefixPrompt: 'review this',
    });

    vi.resetModules();
    const reloaded = await import('./state.svelte');
    expect({ ...reloaded.settings }).toEqual({ ...settings });
  });
});
