# Redline Design System

## Company & product

Redline is a desktop app for code review. It connects to GitHub, syncs pull requests and review comments, and gives a clean, friendly diff-reading interface — so reviewers can take notes quickly while reading code, organize their feedback, and copy review context to CLI coding agents (Codex, Claude, etc.).

**Origin:** the system began as a GitHub-inspired first pass built from one screenshot. It has since been redesigned freely, with the owner's approval, into the calm, steady look described below; GitHub's tokens are no longer a constraint. The owner's stated direction: stable and composed, not flashy.

The visual system is a calm slate-and-steel-blue theme (light and dark) with floating cards, bundled Geist type and restrained motion. The success/danger/warning hues and the diff add/remove colours still follow GitHub's familiar green and red so a diff reads at a glance.

## Components

Source of truth: `src/lib/components/` for components shared across routes; review-only
components colocate at `src/routes/review/components/` instead (see
`docs/decisions/0004-route-colocation-over-early-lib-sharing.md`). Both are Svelte 5, runes.

- Core (`lib/components/`) — Button, IconButton, Icon
- Forms (`lib/components/`) — Input, Textarea
- Feedback (`lib/components/`) — Badge
- Comments (`routes/review/components/`) — Avatar*, CommentThread (+ CommentItem)
- Diff (`routes/review/components/`) — FileTree (+ FileTreeRow), DiffLine (+ DiffHunk, DiffLineSplit)
- Desktop-app chrome — QueueDrawer (+ QueueItem), QueueFab, FileHeader are in
  `routes/review/components/`; Dropdown, FetchButton, SettingsModal, EmptyState stay in
  `lib/components/` (plausibly reusable by a future non-review route)
- Other primitives (`lib/components/`) — Modal, Toast/ToastStack, Checkbox, Switch, Tooltip, Segmented

\* `Avatar` is grouped with Comments by usage but lives in `lib/components/` — it's a generic
identity primitive, not review-specific.

`Segmented` is one reusable component covering what would otherwise be two near-identical toggles (the topbar's diff-mode toggle, the diff panel's unified/split view toggle).

Worth knowing: `CommentThread`'s `comments` items use a plain `text: string` field rather than a rich content node — keeps the prop shape simple since there's no need for arbitrary child content there.

## Reference implementation

`src/routes/review/+page.svelte` is the full reference screen: topbar with repo/branch `Dropdown`s, a diff-mode `Segmented` toggle, and a `FetchButton`; a diff panel with a `FileHeader`, a Unified/Split `Segmented` view toggle, and gutter drag-to-select-range commenting (mouse down on a line's gutter, drag across lines, release to open a comment anchored to that range); a `QueueDrawer` that lists comments saved to the Comment Queue for a CLI agent; and a `QueueFab` that toggles it and shows the saved count. Submitting any comment saves it to the queue and opens the drawer automatically.

Both views comment the same way: the gutter drag handle appears on the new side only — the right column in Split view, a line with a new-side number in Unified — because a deleted line is gone from the worktree and can't be anchored to (docs/decisions/0010). Esc closes the open comment thread. A hunk header collapses its own hunk, and the `FileHeader` toggle collapses or expands them all; collapsing the hunk an open thread sits in closes the thread with it.

Settings and empty states: `src/lib/components/SettingsModal.svelte` (Modal + Segmented + Dropdown + Switch + Textarea) covers Appearance (theme, language), View (zoom, diff font size, default diff mode), and Copy to Agent (optional prefix prompt), wired to a "Settings" entry at the bottom of the sidebar. `src/lib/components/EmptyState.svelte` (`size="md"`/`"sm"`) covers: no project/branch selected, no diff on the current branch, no file matches the sidebar filter. The review page also has a small fixed "DEMO STATE" switcher (normal/no-project/no-diff, top-right) for previewing the empty states — a prototype-only aid, not meant to ship.

## Guidelines

- `guidelines/colors-*.html` — neutral ramp, accent, semantic, diff colors
- `guidelines/type-*.html` — sans and mono type scales
- `guidelines/spacing-scale.html`, `guidelines/radius-elevation.html`
- `guidelines/brand-wordmark.html` — the type-only "Redline" wordmark placeholder

Open any of these directly in a browser to preview a token category — they link straight to the app's real tokens (`../../../../src/lib/styles/tokens/index.css`), not a local copy.

## Tokens

Single source of truth: `src/lib/styles/tokens/{colors,typography,spacing}.css` in the app (imported as `index.css`). This skill folder does **not** keep its own copy — edit the app's tokens and both the components and the `guidelines/*.html` previews here update automatically.

## CONTENT FUNDAMENTALS

- **Language**: sample content is Traditional Chinese, suggesting primary users write in Chinese day to day, while code, file paths, and commit copy stay in English. UI chrome defaults to English but the app must render CJK text natively and comfortably.
- **Tone**: terse, functional, developer-to-developer. No exclamation points, no marketing voice.
- **Casing**: sentence case throughout ("Resolve comment", not "RESOLVE COMMENT").
- **Voice**: direct, second-person where the app addresses the user ("Write a reply"), neutral/observational for system state ("Synced 2m ago").
- **Emoji**: none as copy. The only "reaction" affordance is a smile icon (add-emoji-reaction button).

## VISUAL FOUNDATIONS

- **Diff hues:** add/remove keep conventional green and red (tinted gutters, a thin bar on the left edge, stronger background for within-line changes). The hunk header is a faint blue tint (`--diff-hunk-bg`).
- **Palette**: calm and steady. Cool slate neutrals on a lightly tinted canvas with white cards in light; deep blue-black in dark (Settings → Theme: System / Light / Dark; tokens redefined under `:root[data-theme="dark"]` and the OS preference in `colors.css`). One restrained brand accent, steel blue (`--accent`), used for primary actions, the active file row, the branch pill, comment affordances and focus rings. No gradients or glows in the working UI. Diff add/remove stay green/red. Components must use semantic tokens (`--bg-raised`, `--bg-active`, `--on-emphasis`, `--text-*`), never raw `--gray-*`/hex, so both themes work.
- **Type**: **Geist** for UI, **Geist Mono** for code, **Instrument Serif** (display) for the Welcome headline only. All three are bundled via `@fontsource` — no network needed at runtime; CJK falls through to the OS font.
- **Spacing**: 4px base unit, scale at 4/8/12/16/20/24/32/48/64.
- **Backgrounds**: flat and functional in the working UI. The first-run `Welcome` screen is just as quiet: serif headline, one button, a static mini diff. The Z `Logo` mark is a subtle steel-blue fill.
- **Animation**: restrained and purposeful, driven by `--ease-out` / `--ease-spring` and `--dur-*` tokens (all collapse to 0 under `prefers-reduced-motion`): sliding pill in `Segmented`, chevron rotation in the tree and hunks, fade-up for empty states / threads, drawer slide-in, modal pop, shimmer skeleton while the tree loads.
- **Hover states**: subtle background shifts (`--bg-subtle` on rows/buttons), never color inversion or scale changes.
- **Press states**: slightly darker shade of the hover background, no shrink/scale.
- **Borders**: 1px hairlines (`--border-default`) separate the floating cards and rows; `--border-muted` is the lighter divider inside a card. Shadows stay soft (`--shadow-sm` on cards, `--shadow-lg` on floating layers).
- **Shadows**: minimal. A comment thread card gets a small elevation (`--shadow-md`); everything else is flat with borders only.
- **Corner radii**: 5–8px on buttons/inputs, 12–16px on cards, modals and the comment thread. Pills only for status badges, counts and the branch indicator.
- **Layout**: the sidebar, diff panel and queue drawer float as rounded cards (`--radius-xl`) on the tinted canvas with a 10px gap; the topbar sits directly on the canvas. `⌘K` / `Ctrl+K` opens a command palette to jump to a changed file.
- **Transparency/blur**: only on floating chrome — the topbar, the sticky file header (`--bg-glass` + backdrop blur) and the modal scrim.
- **Imagery**: none — this is a text/code-first tool.

## ICONOGRAPHY

Small monochrome line icons (chevrons, copy, emoji-reaction) — a stroke-based icon set. Uses **Lucide** (lucide.dev, MIT-licensed). In this repo, use the `lucide-svelte` package via `src/lib/components/Icon.svelte`. This is a **substitution, flagged for the user**: if Redline's real app uses a different icon set, swap it out.

## Fonts

Bundled with the app through `@fontsource-variable/geist`, `@fontsource-variable/geist-mono` and `@fontsource/instrument-serif` (all SIL OFL), imported in `tokens/typography.css`. Geist has no CJK glyphs, so Traditional Chinese renders in the platform font (PingFang TC / Noto Sans TC / Microsoft JhengHei).

## Logo

The `Logo` component (`src/lib/components/Logo.svelte`) is a Z built from a diff — two bars joined by a stroke — on a subtle steel-blue fill, set beside a Geist bold wordmark (`guidelines/brand-wordmark.html`). It is a designed placeholder, not final brand art.

## Open questions / next steps

Only genuine design questions live here — things that need a person to decide or an example to point to. Implementation-only follow-ups (add a library, wire up real state) have been moved out: they don't need another pass through this design system, and listing them here just clutters the one list that's supposed to say what still needs design input.

1. Final brand assets: the **logo** above is a designed placeholder, and the steel-blue accent is the owner's approved direction but not yet a formal brand spec.
2. Confirmation of tone/voice guidelines — there's now a real body of applied copy to point to (`SettingsModal`, the empty states, comment threads), all following the same terse dev-to-dev voice, but nobody's signed off that it's actually right for Redline.

**Resolved (kept for history, not action items):** additional screens — PR list/inbox (ruled out of scope for v1: local repos/diffs only), settings, empty states, the copy-to-agent flow (turned out to be plain copy-to-clipboard), and the Project dropdown's "add new" entry are all designed and shipped in `src/lib/components/` and `review/+page.svelte`.

**Not design questions, intentionally not tracked here:** the "add project" folder picker (needs a native Tauri dialog + a persisted project list) and wiring the fetch-failure `Toast` to a real `git fetch` call are pure implementation work with no open design decision — track them wherever the app's engineering work is tracked, not in this doc.
