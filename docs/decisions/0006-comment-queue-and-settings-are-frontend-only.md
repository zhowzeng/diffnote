# Comment Queue and Settings are frontend-only state, not backend-persisted

Neither the [[Comment Queue]] nor app Settings gets a Rust command or disk-backed storage. The Comment Queue lives in frontend session state and clears when the app closes — consistent with ADR 0001's one-sitting "review now, hand off to a CLI agent" workflow, and surviving a restart is not something reviewers want from it. Settings persist via the Tauri WebView's own `localStorage`, which already survives app restarts without any Rust involvement. This keeps the early command surface scoped to the git/filesystem reads described in ADR 0005, rather than adding IPC and a storage format for state that doesn't need one yet.

## Considered Options

- **Backend-persisted Comment Queue** (a Rust command + on-disk file): rejected — adds IPC surface and a storage format decision, and the need that would justify them was looked for in use and isn't there. A queue that outlives the app also outlives the lines it points at: comments anchor to worktree line numbers (ADR 0010), and the CLI agent the queue exists to feed is what rewrites those lines — so persistence would mostly keep stale anchors alive.
- **Backend-persisted Settings** (e.g. `~/.config/redline/settings.json`): rejected for now — `localStorage` already covers cross-restart persistence for free; revisit only if settings need to be read outside the webview (e.g. by a CLI companion).
