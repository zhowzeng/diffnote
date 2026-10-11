// Which lines the reviewer is picking out to comment on, and the draft text for them.
//
// A selection names flat line indexes into the lines on screen when it was made —
// against any other lines those indexes point at different code, or at nothing. So it
// holds on to reviewState.shownVersion and counts as closed once that moves on: choosing
// another Repo, Diff Mode, file, or a reload that brings back different lines all drop
// it, without each of them having to remember to.

import { reviewState } from './state.svelte';

interface Range {
  lo: number;
  hi: number;
}

class Selection {
  // The committed range the comment thread is open on, or null when no thread is open.
  #range = $state<Range | null>(null);
  // A drag in progress. `start` is wherever the mouse went down, so it can sit above or
  // below `end` — the pair is only put in order once the drag is committed.
  #drag = $state<{ start: number; end: number } | null>(null);
  // The lines on screen when the range or drag above was made.
  #on = $state(0);
  draft = $state('');

  get #current() {
    return this.#on === reviewState.shownVersion;
  }

  get range(): Range | null {
    return this.#current ? this.#range : null;
  }

  // Where the drag began, so the caller can check its own "still the same hunk?" rule
  // before extending — which lines are adjacent is the diff's business, not this one's.
  get dragStart(): number | null {
    return this.#current ? (this.#drag?.start ?? null) : null;
  }

  startDrag(i: number) {
    // A range left over from lines no longer on screen must not come back with the new
    // drag's version.
    if (!this.#current) this.#range = null;
    this.#drag = { start: i, end: i };
    this.#on = reviewState.shownVersion;
  }

  extendDrag(i: number) {
    if (this.#drag && this.#current) this.#drag = { ...this.#drag, end: i };
  }

  // Runs on mouseup wherever it lands, so a drag that ran off the diff still commits.
  commitDrag() {
    if (!this.#drag) return;
    const { start, end } = this.#drag;
    this.#drag = null;
    if (this.#current) this.openAt(Math.min(start, end), Math.max(start, end));
  }

  openAt(lo: number, hi: number = lo) {
    this.#range = { lo, hi };
    this.#on = reviewState.shownVersion;
    this.draft = '';
  }

  // The drag wins while one is in progress, so the highlight grows with the mouse
  // instead of staying on whatever range was open before it started.
  includes(i: number) {
    if (!this.#current) return false;
    const drag = this.#drag;
    const range = drag
      ? { lo: Math.min(drag.start, drag.end), hi: Math.max(drag.start, drag.end) }
      : this.#range;
    return range !== null && i >= range.lo && i <= range.hi;
  }

  close() {
    this.#range = null;
    this.#drag = null;
    this.draft = '';
  }
}

export const selection = new Selection();
