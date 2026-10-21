<script>
  import Icon from '$lib/components/Icon.svelte';
  import InlineText from './InlineText.svelte';

  const PREFIX = { add: '+', del: '−', context: '' };

  /**
   * @typedef {{ idx: number, kind?: 'context'|'add'|'del', no?: number|null, text?: string, commentable?: boolean } | null} Side
   */

  /**
   * @typedef {Object} Props
   * @property {Side} left
   * @property {Side} right
   * @property {import('../helpers').InlineSegment[]} [leftSegments]
   * @property {import('../helpers').InlineSegment[]} [rightSegments]
   * @property {import('../highlight').SyntaxToken[]} [leftTokens]
   * @property {import('../highlight').SyntaxToken[]} [rightTokens]
   * @property {boolean} [leftCommented]
   * @property {boolean} [rightCommented]
   * @property {boolean} [leftSelected]
   * @property {boolean} [rightSelected]
   * @property {(index: number) => void} [onGutterDown]
   * @property {(index: number) => void} [onGutterEnter]
   */

  /** @type {Props} */
  let {
    left,
    right,
    leftSegments,
    rightSegments,
    leftTokens,
    rightTokens,
    leftCommented = false,
    rightCommented = false,
    leftSelected = false,
    rightSelected = false,
    onGutterDown,
    onGutterEnter,
  } = $props();

  let rightHover = $state(false);

</script>

<!-- The row is laid out by DiffPanel's split grid: each side is a cell of it. -->
<div class="row">
  <!-- The left column carries the old side only: a drag started there would anchor a
       comment to a line the worktree no longer has (docs/decisions/0010). It still
       highlights when a drag down the new side sweeps past it, same as Unified view. -->
  <div class="side {left?.kind ?? 'context'}" class:empty={!left} class:selected={leftSelected}>
    <span class="no">{left ? left.no ?? '' : ''}</span>
    <span class="mark" title={left && leftCommented ? '這一行已留言' : undefined}>
      {#if left && leftCommented}
        <Icon name="message-square" size={11} color="var(--accent-emphasis)" />
      {/if}
    </span>
    <span class="sign">{left ? PREFIX[left.kind || 'context'] : ''}</span>
    <span class="code">{#if left}<InlineText text={left.text ?? ''} segments={leftSegments} tokens={leftTokens} kind={left.kind || 'context'} />{/if}</span>
  </div>
  <div class="divider"></div>
  <div
    class="side {right?.kind ?? 'context'}"
    class:empty={!right}
    class:selected={rightSelected}
    role="presentation"
    onmouseenter={() => {
      rightHover = true;
      if (right) onGutterEnter?.(right.idx);
    }}
    onmouseleave={() => (rightHover = false)}
  >
    {#if right?.commentable && (rightHover || rightSelected) && onGutterDown}
      <button
        class="add-btn"
        onmousedown={(e) => {
          e.preventDefault();
          onGutterDown(right.idx);
        }}
        title="Add comment (drag to select multiple lines)"
        aria-label="Add comment"
      >+</button>
    {/if}
    <span class="no">{right ? right.no ?? '' : ''}</span>
    <span class="mark" title={right && rightCommented ? '這一行已留言' : undefined}>
      {#if right && rightCommented}
        <Icon name="message-square" size={11} color="var(--accent-emphasis)" />
      {/if}
    </span>
    <span class="sign">{right ? PREFIX[right.kind || 'context'] : ''}</span>
    <span class="code">{#if right}<InlineText text={right.text ?? ''} segments={rightSegments} tokens={rightTokens} kind={right.kind || 'context'} />{/if}</span>
  </div>
</div>

<style>
  .row {
    display: contents;
    font-family: var(--font-mono);
    font-size: var(--diff-font-size);
    line-height: var(--diff-line-height);
  }
  .divider {
    width: 1px;
    background: var(--border-muted);
    flex-shrink: 0;
  }
  .side {
    display: flex;
    position: relative;
    min-width: 0;
    --line-bg: transparent;
    --line-bar: transparent;
    --line-sign: var(--text-tertiary);
    background: var(--line-bg);
    box-shadow: inset 2px 0 0 var(--line-bar);
  }
  .side.add {
    --line-bg: var(--diff-add-bg);
    --line-bar: var(--diff-add-border);
    --line-sign: var(--diff-add-text);
  }
  .side.del {
    --line-bg: var(--diff-remove-bg);
    --line-bar: var(--diff-remove-border);
    --line-sign: var(--diff-remove-text);
  }
  .side.empty {
    --line-bg: var(--bg-subtle);
  }
  .side.context:not(.empty):hover {
    --line-bg: var(--bg-subtle);
  }
  .side.selected {
    --line-bg: var(--accent-subtle);
    --line-bar: var(--accent);
    --line-sign: var(--accent-emphasis);
  }
  .no {
    width: 38px;
    padding-right: 8px;
    padding-left: 2px;
    flex-shrink: 0;
    text-align: right;
    color: var(--text-tertiary);
    user-select: none;
    font-variant-numeric: tabular-nums;
  }
  .mark {
    width: 16px;
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
