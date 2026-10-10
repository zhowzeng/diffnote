// Shiki itself, run only inside the highlight worker (highlight.worker.ts), so a big
// file tokenizing never holds up the window. Shiki tokenizes a whole file at once, so a
// line's colours follow from everything above it — a hunk that starts inside a block
// comment still reads as a comment (docs/decisions/0017).

import { createCssVariablesTheme, createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import { bundledLanguages, type BundledLanguage } from 'shiki/langs';
import type { SyntaxToken } from './highlight';

const THEME = 'redline';

let highlighter: Promise<HighlighterCore> | null = null;

function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= createHighlighterCore({
    themes: [createCssVariablesTheme({ name: THEME, variablePrefix: '--syntax-', fontStyle: false })],
    langs: [],
    // Plain JS regexes, not the Oniguruma WASM build. `forgiving` leaves a pattern the
    // JS engine can't compile unmatched instead of failing the whole grammar.
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });
  return highlighter;
}

// The grammar for a path: its extension (`ts`, `rs`), or the whole name for files
// that have none (`Dockerfile`, `Makefile`). Grammars are loaded on first use.
export function languageOf(path: string): BundledLanguage | null {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  const key = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : name;
  return Object.hasOwn(bundledLanguages, key) ? (key as BundledLanguage) : null;
}

// Each line of `text` as coloured tokens, indexed by line number - 1. Null when the
// path has no known grammar.
export async function tokenize(path: string, text: string): Promise<SyntaxToken[][] | null> {
  const lang = languageOf(path);
  if (!lang) return null;
  const hl = await getHighlighter();
  await hl.loadLanguage(bundledLanguages[lang]);
  return hl
    .codeToTokensBase(text, { lang, theme: THEME })
    .map((line) => line.map((t) => ({ text: t.content, color: t.color })));
}
