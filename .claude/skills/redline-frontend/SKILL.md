---
name: redline-frontend
description: >
  Redline's frontend conventions for its Svelte 5 + SvelteKit (Tauri SPA, no server) codebase:
  where new code lives (route colocation vs src/lib/), state module structure and naming,
  Svelte 5 rune patterns, and which SvelteKit routing features are off-limits in a static
  Tauri build. Load this before adding or changing any frontend code — new components,
  routes, state, helpers, or edits to existing .svelte / .svelte.ts / .ts files under
  src/routes/ or src/lib/. Triggers on $state, $derived, $effect, $props, $bindable,
  .svelte.ts, src/routes/, src/lib/, "add a route", "new component", "new page".
---

# Redline Frontend Conventions

## Colocation: where new code lives

**Route owns route-local code.** Components, state, helpers, types, and API wrappers that
only serve a single route live in that route's own folder under `src/routes/`, and get
added/removed together with the route.

**Shared code goes in `src/lib/`.** Only move something to `src/lib/<feature>/` once it is
actually used by two or more routes/surfaces.

**Decision rule:** default to keeping new code inside the route folder. Only lift it to
`src/lib/<feature>/` once a second route/surface genuinely needs it — don't move it
preemptively "in case" it's reused later. See `docs/decisions/0004-route-colocation-over-early-lib-sharing.md`.

```
src/routes/
  review/
    +page.svelte
    state.svelte.ts        # route-local state, only used by review/
    helpers.ts              # route-local helper, only used by review/

src/lib/
  <feature>/                # only exists once 2+ routes share this
    state.svelte.ts
    components/
```

## State modules: `state.svelte.ts`

Default filename for a Svelte 5 rune-based state module is `state.svelte.ts` (route-local)
or `src/lib/<feature>/state.svelte.ts` (shared). `.svelte.ts` files behave like normal
TypeScript modules except they can use runes — this is Svelte 5-only, no equivalent in v4.

Two supported patterns for exposing state across modules:

**1. Export an object, mutate its properties (preferred for objects):**
```ts
// state.svelte.ts
export const reviewState = $state({
	selectedFile: null,
	comments: []
});
```
```ts
// caller
import { reviewState } from './state.svelte.ts';
reviewState.selectedFile = file; // OK — mutating a property
```
Never reassign the exported binding itself (`reviewState = {...}`) — that breaks the
reactivity link for every importer. Only mutate its properties/fields.

**2. Keep `$state` module-private, export getter/setter functions (preferred for primitives):**
```ts
// state.svelte.ts
let count = $state(0);
export function getCount() { return count; }
export function increment() { count += 1; }
```

## `$state`

- Objects and arrays wrapped in `$state` become deep-reactive proxies — mutating a nested
  field (`todos[0].done = true`) or array method (`todos.push(...)`) triggers updates, no
  need to reassign.
- **Destructuring breaks reactivity.** `let { done } = todos[0]` captures a snapshot value,
  not a live binding — `done` won't update when `todos[0].done` changes later. Keep the
  object reference around and read through it instead.
- **`$state.raw`** opts an object/array out of the reactive proxy (perf escape hatch for
  large/immutable data) — mutating a field does nothing; you must reassign the whole value
  to trigger an update.
- Class fields/constructors can hold `$state` directly (see State modules section above).

## `$derived`

- **Use `$derived` over `$effect` for computed values.** `$effect` should never be used to
  sync/compute state.
- `$derived` takes an expression; use `$derived.by(() => ...)` when the logic needs a
  function body (loops, multiple statements).
- **Never cause side effects inside a `$derived` expression** — it must stay pure.
- Deriveds are writable: you can assign an override (e.g. for optimistic UI), and it holds
  until the next dependency change re-evaluates it:
  ```ts
  let likes = $derived(post.likes);
  async function onclick() {
  	likes += 1; // optimistic
  	try { await likePost(); } catch { likes -= 1; } // rollback
  }
  ```
- If the derived expression evaluates to an object/array, it's returned as-is — not made
  deeply reactive. Use `$state` inside `$derived.by` in the rare case you need that.

## `$effect`

**An escape hatch — avoid it.** Don't update state inside an effect (never sync two pieces
of state via `$effect`s, which can create circular updates). Reach for it only for:
external-library sync (D3, canvas) — prefer `{@attach ...}` when possible; logging/debug —
use `$inspect`, not `console.log` in an effect; observing something external to Svelte —
use `createSubscriber`.

- **Teardown**: return a cleanup function — it runs before the next re-run and on unmount.
  ```ts
  $effect(() => {
  	const id = setInterval(() => count++, 1000);
  	return () => clearInterval(id);
  });
  ```
- **Dependency tracking is synchronous-only.** Only `$state`/`$derived` reads that happen
  synchronously during the effect body are tracked; reads inside a `setTimeout`/after an
  `await` are invisible to the tracker.
- **Dependencies can be conditional** — only what was actually read on the *last* run counts,
  so an `if` branch not taken this run drops its dependency until it's taken again.
- **`$effect.pre`** runs before DOM updates instead of after (rare — autoscroll-style cases).
- Never wrap effect contents in `if (browser) {...}` — effects don't run server-side anyway,
  and Redline has no server (see SvelteKit routing below).

## `$props`

- Destructure with defaults: `let { message, count = 0 } = $props();`
- Rename reserved/invalid identifiers: `let { super: trouper = 'default' } = $props();`
- Rest props: `let { a, b, ...others } = $props();`
- Type with an interface: `let { message, count = 0 }: Props = $props();`
- **Don't mutate props.** Use callback props (replaces `createEventDispatcher`, deprecated
  in Svelte 5), `$bindable` for two-way binding, or copy into local `$state` for
  component-local state. Prefer callback props over `$bindable` — reach for `$bindable`
  only when parent and child genuinely need to share the same mutable value.
  ```ts
  let { value = $bindable('default value') } = $props(); // fallback when unbound
  ```

## Template syntax

- **Snippets replace slots.** `{#snippet name(args)}...{/snippet}` + `{@render name(args)}`,
  can be passed explicitly as a prop to a child component.
- **Always key `{#each}` blocks over dynamic lists**: `{#each items as item (item.id)}` —
  without a key, Svelte diffs by index and can reuse/misattribute DOM state across reorders.

## SvelteKit routing (Redline runs as a Tauri SPA — no server)

Redline uses `adapter-static` with an `index.html` SPA fallback (see `svelte.config.js`) because
Tauri has no Node.js server to do SSR. This rules out anything that needs a server runtime:

- **Don't add `+page.server.ts`, `+layout.server.ts`, `+server.ts`, or form actions** — there
  is no server to run them; the static adapter won't serve them for Tauri.
  `PUBLIC_`/private `$env/static/private` distinctions and Server-Sent Events likewise don't
  apply here.
- **Use `+page.ts`/`+layout.ts` (universal load)** when a route needs a `load` function —
  it runs client-side only in Redline's build.
- **Dynamic route params**: `[slug]` (one segment), `[...rest]` (catch-all),
  `[[optional]]` (optional segment).
- **Navigate with `goto()`** from `$app/navigation` for programmatic client-side navigation.
- Access load data via `let { data } = $props();` in the page/layout component.

## References

- Official docs: `github.com/sveltejs/svelte` → `documentation/docs/07-misc/01-best-practices.md`,
  `02-runes/*.md`, `01-introduction/04-svelte-js-files.md`.
- Fetch via Context7 MCP (`resolve-library-id` → `/sveltejs/svelte`) for anything not covered here.
- Rune fundamentals partly merged from the community skill
  [splinesreticulating/claude-svelte5-skill](https://github.com/splinesreticulating/claude-svelte5-skill),
  trimmed to what applies to Redline's Tauri SPA (server-only SvelteKit features removed).
