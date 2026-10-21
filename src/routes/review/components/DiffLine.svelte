<script>
  import Icon from '$lib/components/Icon.svelte';

  const PREFIX = { add: '+', del: '−', context: '' };

  /**
   * @typedef {Object} Props
   * @property {'context'|'add'|'del'} [kind]
   * @property {number|null} [oldNo]
   * @property {number|null} [newNo]
   * @property {import('svelte').Snippet} [children]
   * @property {boolean} [commentable]
   * @property {(e: MouseEvent) => void} [onAddComment]
   * @property {number} index
   * @property {boolean} [selected]
   * @property {boolean} [commented]
   * @property {(index: number) => void} [onGutterDown]
   * @property {(index: number) => void} [onGutterEnter]
   */

  /** @type {Props} */
  let {
    kind = 'context',
    oldNo,
    newNo,
    children,
    commentable = false,
    onAddComment,
    index,
    selected = false,
    commented = false,
    onGutterDown,
    onGutterEnter,
  } = $props();

  let hover = $state(false);
</script>

<div
  class="line {kind}"
  class:selected
  role="presentation"
  onmouseenter={() => {
    hover = true;
    onGutterEnter?.(index);
  }}
  onmouseleave={() => (hover = false)}
>
  <!-- A del line is gone from the worktree, so `path:L12` for it would name a line the
       CLI agent reads as something else — no affordance there (docs/decisions/0010).
       This matches Split view, where only the new-side column offers it. -->
  {#if (hover || selected) && onGutterDown && newNo !== null}
    <button
      class="add-btn"
      onmousedown={(e) => {
        e.preventDefault();
        onGutterDown(index);
      }}
      title="Add comment (drag to select multiple lines)"
      aria-label="Add comment"
    >+</button>
  {/if}
  <span class="gutter">
    <span class="no old">{oldNo ?? ''}</span>
    <span class="no new">{newNo ?? ''}</span>
  </span>
  <span class="mark" title={commented ? '這一行已留言' : undefined}>
    {#if commented}
      <Icon name="message-square" size={12} color="var(--accent-emphasis)" />
    {/if}
  </span>
  <span class="sign">{PREFIX[kind]}</span>
  <span class="code">{@render children?.()}</span>
  {#if commentable && hover && !onGutterDown}
    <button class="add-btn inline" onclick={onAddComment} title="Add comment" aria-label="Add comment">+</button>
  {/if}
</div>

<style>
  .line {
    display: flex;
    position: relative;
    font-family: var(--font-mono);
    font-size: var(--diff-font-size);
    line-height: var(--diff-line-height);
    --line-bg: transparent;
    --line-gutter: transparent;
    --line-bar: transparent;
    --line-sign: var(--text-tertiary);
    background: var(--line-bg);
    box-shadow: inset 2px 0 0 var(--line-bar);
  }
  .line.add {
    --line-bg: var(--diff-add-bg);
    --line-gutter: var(--diff-add-gutter);
    --line-bar: var(--diff-add-border);
    --line-sign: var(--diff-add-text);
  }
  .line.del {
    --line-bg: var(--diff-remove-bg);
    --line-gutter: var(--diff-remove-gutter);
    --line-bar: var(--diff-remove-border);
    --line-sign: var(--diff-remove-text);
  }
  .line.context:hover {
    --line-bg: var(--bg-subtle);
  }
  .line.selected {
    --line-bg: var(--accent-subtle);
    --line-gutter: var(--accent-subtle);
    --line-bar: var(--accent);
    --line-sign: var(--accent-emphasis);
  }

  .gutter {
    display: flex;
    flex-shrink: 0;
    background: var(--line-gutter);
    padding-left: 2px;
    font-variant-numeric: tabular-nums;
  }
  .no {
    width: 38px;
    padding-right: 8px;
    text-align: right;
    color: var(--text-tertiary);
    user-select: none;
  }
  .mark {
    width: 18px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    user-select: none;
  }
  .sign {
    width: 14px;
    flex-shrink: 0;
    color: var(--line-sign);
    user-select: none;
    font-weight: 500;
  }
  .code {
    color: var(--text-primary);
    white-space: var(--diff-white-space, pre);
    overflow-wrap: anywhere;
    min-width: 0;
  }

  .add-btn {
    position: absolute;
    left: 6px;
    top: 1px;
    z-index: 1;
    width: 18px;
    height: 18px;
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: var(--accent-emphasis);
    color: var(--on-emphasis);
    font: 600 14px/1 var(--font-sans);
    cursor: pointer;
    animation: z-pop var(--dur-fast) var(--ease-out);
  }
  .add-btn.inline {
    left: auto;
    right: 8px;
  }
  .add-btn:hover {
    background: var(--accent-strong);
  }
</style>
