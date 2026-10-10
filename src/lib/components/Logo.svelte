<script>
  /** @type {{ size?: number }} */
  let { size = 24 } = $props();
  let id = $props.id();
</script>

<!-- The mark is a Z cut from a diff: a short add bar on top, a remove bar below, joined by the stroke between them. -->
<svg width={size} height={size} viewBox="0 0 32 32" fill="none" role="img" aria-label="Redline">
  <defs>
    <linearGradient id="g{id}" x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
      <stop stop-color="#3f6d9f" />
      <stop offset="1" stop-color="#27527f" />
    </linearGradient>
  </defs>
  <rect width="32" height="32" rx="8" fill="url(#g{id})" />
  <rect x="0.5" y="0.5" width="31" height="31" rx="8.5" stroke="rgba(255,255,255,.28)" />
  <path d="M9.5 10.5h13l-13 11h13" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" />
</svg>
