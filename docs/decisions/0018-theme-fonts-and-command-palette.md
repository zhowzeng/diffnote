# The theme is a frontend setting, the fonts ship with the app, and the palette only lists changed files

**Theme.** Light, Dark or System is one more field in the settings kept in the WebView's
localStorage (ADR 0006); no Rust command is involved. `colors.css` defines every colour twice, under
`:root` and `:root[data-theme="dark"]`, plus the OS preference while the setting is "system" (no
attribute). `app.html` applies the saved theme before first paint so a dark Redline never flashes white.
Components use semantic tokens (`--bg-raised`, `--on-emphasis`, `--text-*`), never raw `--gray-*` or
hex, so a theme is a second set of variables and nothing else. Syntax colours are `var(--syntax-*)`
(ADR 0017), which is why the dark theme needed no second tokenization.

**Fonts.** Geist, Geist Mono and Instrument Serif are bundled through `@fontsource` packages and
imported in `tokens/typography.css`, rather than loaded from Google Fonts. Redline is a desktop app that is
often used on a plane or behind a proxy; a font that depends on the network flashes or falls back
there. Geist has no CJK glyphs, so Traditional Chinese uses the platform font.

**Command Palette.** `Ctrl/⌘ + K` opens a modal that jumps to a changed file by name
(`routes/review/palette.ts`, `CommandPalette.svelte`). It lists only changed files — the same set the
sidebar shows by default — and not "all files", so it stays a short list, and `j` / `k` and the palette
agree about what "the files of this review" means. It is route-local (ADR 0004).

## Considered Options

- **Theme in Rust config**: rejected. It is a presentation preference with no effect on repo access,
  the same reasoning as ADR 0006.
- **Keep Google Fonts**: rejected for the offline reason above, and because it sends a request to a
  third party every time the window opens.
- **Palette over every file in the repo**: rejected. It would need a full tree read and a much longer
  list; "Show all files" in the sidebar already covers browsing.
