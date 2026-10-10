<script>
  /** @type {{ size?: number }} */
  let { size = 24 } = $props();
  let id = $props.id();
</script>

<!-- The mark is three lines of text with the middle one marked in red: a line picked out to comment on. -->
<svg width={size} height={size} viewBox="0 0 32 32" fill="none" role="img" aria-label="Diffnote">
  <defs>
    <linearGradient id="g{id}" x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
      <stop stop-color="#3f6d9f" />
      <stop offset="1" stop-color="#27527f" />
    </linearGradient>
  </defs>
  <rect width="32" height="32" rx="8" fill="url(#g{id})" />
  <rect x="0.5" y="0.5" width="31" height="31" rx="8.5" stroke="rgba(255,255,255,.28)" />
  <rect x="6" y="12.5" width="20" height="7" rx="2" fill="#ff5d5d" />
  <path d="M9 9h14M9 16h12M9 23h9" stroke="#fff" stroke-width="2.4" stroke-linecap="round" />
</svg>
