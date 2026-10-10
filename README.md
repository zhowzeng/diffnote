# Diffnote

Diffnote is a desktop app for reviewing local git diffs — reading changed files, leaving
comments anchored to diff lines, and copying review notes to CLI coding agents.

The review screen is the whole app: pick a local repo in the topbar, pick how the diff is
computed (unstaged, staged, or everything done on the branch), read the changed files, and
leave comments on the lines you want changed. Each comment is either copied straight to the
clipboard or added to that repo's comment queue; copying the queue hands the whole round to
a CLI agent as `path:L12` references it can open.

## Status

A personal tool, built for its author's own reviews. There are no releases and no installers
to download — the way to get it is to build it from source, below. It runs on Linux and
Windows, which are the two platforms CI covers.

## Prerequisites

- [Bun](https://bun.sh)
- Rust 1.92 (the toolchain CI pins)
- Tauri's own system dependencies for your platform — see
  [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). On Debian/Ubuntu that is
  `libwebkit2gtk-4.1-dev`, `build-essential`, `curl`, `wget`, `file`, `libxdo-dev`,
  `libssl-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, plus `patchelf` for the AppImage
  bundle.
- `ssh` access to your repos' remotes, if you want Diffnote's `Fetch` to work — it is ssh-only
  (see ADR 0011).

## Running it

```sh
bun install
bun tauri dev
```

## Building it

```sh
bun tauri build
```

The installers land under `src-tauri/target/release/bundle/` — `.deb`, `.rpm` and
`.AppImage` on Linux, `.msi` and an NSIS `.exe` on Windows. Nothing signs them, so a
machine other than the one that built them will warn before opening them.

The same build also runs from GitHub Actions on demand: the **Build Desktop App** workflow
is `workflow_dispatch`-only and uploads the bundles as run artifacts.

## Checks

```sh
bun run check      # svelte-check, the only type checking this project has
bun run test       # frontend unit tests

cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

## Docs

- `CONTEXT.md` — the domain glossary. Read it before naming anything new.
- `docs/decisions/` — ADRs for the decisions that are hard to reverse or easy to re-litigate.

## License

MIT — see [LICENSE](LICENSE).
