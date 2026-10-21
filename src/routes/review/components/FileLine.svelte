<script>
  import Icon from '$lib/components/Icon.svelte';
  import InlineText from './InlineText.svelte';

  /**
   * One line of a file shown in File View: worktree content with its own line number
   * and no diff colouring, but the same gutter affordance for leaving a comment.
   *
   * @typedef {Object} Props
   * @property {number} lineNo
   * @property {string} content
   * @property {import('../highlight').SyntaxToken[]} [tokens]
   * @property {number} index
   * @property {boolean} [selected]
   * @property {boolean} [commented]
   * @property {(index: number) => void} [onGutterDown]
   * @property {(index: number) => void} [onGutterEnter]
   */

  /** @type {Props} */
  let { lineNo, content, tokens, index, selected = false, commented = false, onGutterDown, onGutterEnter } = $props();

  let hover = $state(false);
</script>

<div
  class="line"
  class:selected
  role="presentation"
  onmouseenter={() => {
    hover = true;
    onGutterEnter?.(index);
  }}
  onmouseleave={() => (hover = false)}
>
  {#if (hover || selected) && onGutterDown}
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
  <span class="no">{lineNo}</span>
  <span class="mark" title={commented ? '這一行已留言' : undefined}>
    {#if commented}
      <Icon name="message-square" size={12} color="var(--accent-emphasis)" />
    {/if}
  </span>
  <!-- Stands in for the diff's +/- column so File View content lines up with a diff's. -->
  <span class="sign"></span>
  <span class="code"><InlineText text={content} {tokens} kind="context" /></span>
</div>

<style>
  .line {
    display: flex;
    position: relative;
    font-family: var(--font-mono);
    font-size: var(--diff-font-size);
    line-height: var(--diff-line-height);
    background: transparent;
    box-shadow: inset 2px 0 0 transparent;
  }
  .line:hover {
    background: var(--bg-subtle);
  }
  .line.selected {
    background: var(--accent-subtle);
    box-shadow: inset 2px 0 0 var(--accent);
  }
  .no {
    width: 78px;
    padding-right: 8px;
    flex-shrink: 0;
    text-align: right;
    color: var(--text-tertiary);
    user-select: none;
    font-variant-numeric: tabular-nums;
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
  .add-btn:hover {
    background: var(--accent-strong);
  }
</style>
