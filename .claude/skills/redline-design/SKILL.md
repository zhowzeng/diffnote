---
name: redline-design
description: Use this skill to generate well-branded interfaces and assets for Redline, either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read README.md within this skill for the full design system (product background, component inventory, content voice, visual foundations), and browse `guidelines/*.html` for previewable token references (color, type, spacing, radii).

Single source of truth for everything is this repo — no external design system to sync against:
- Tokens: `src/lib/styles/tokens/{colors,typography,spacing}.css` (imported as `index.css`). The `guidelines/*.html` pages link straight to this file, so there's nothing to keep in sync by hand — edit a token once and every component and guideline preview picks it up automatically.
- Production components: `src/lib/components/` (Svelte 5, runes).

When building new UI:
- Prefer reusing an existing component from `src/lib/components/` over writing new inline styles.
- When a component doesn't exist yet, design it directly against the tokens and the guidelines in README.md, following the styling and prop conventions of the existing components.
- If creating throwaway prototypes/mocks, static HTML files against `src/lib/styles/tokens/index.css` are fine.
