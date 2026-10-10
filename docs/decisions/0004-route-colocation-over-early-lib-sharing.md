# Route-local code colocates with the route; `lib/` only for cross-route sharing

Component, state, helper, type, and API-wrapper code that serves a single route lives inside that route's own folder under `src/routes/`, added and removed alongside the route, and moves to `src/lib/<feature>/` only once a second route or surface actually needs it — colocation by default, lifted on confirmed reuse rather than in anticipation of it. Svelte 5 state modules, in either location, use the rune-based `state.svelte.ts` naming convention; see the `diffnote-frontend` skill for the state-module patterns.

## Considered Options

- **A feature-first `lib/` structure from day one**, with single-route code under `src/lib/<feature>/` too: rejected — it forces a shared/not-shared judgment before a second consumer exists, and creates premature abstractions for routes that end up staying single-purpose.
