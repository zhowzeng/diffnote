# Redline ships from source, with no releases

Redline is a tool its author built for their own reviews, and the way to get it is to clone the
repo and run `bun tauri build`. There is no tag-triggered GitHub Release, no published
installer, and no version-bump ritual across `package.json`, `tauri.conf.json` and
`Cargo.toml` — those three stay at `0.1.0` until something actually reads them. The
`Build Desktop App` workflow stays `workflow_dispatch`-only for the reason its own comment
already gives: a full bundle takes far longer than the CI checks and nothing downstream waits
on it.

What this buys is not saved effort on the workflow — that change is small — but staying out of
code signing. An installer handed to someone else is an installer their machine refuses to
open: macOS Gatekeeper and Windows SmartScreen both block unsigned bundles, and answering that
means certificates, a signing identity per platform, and secrets in CI, all to serve a
download nobody has asked for yet.

## Consequences

- `README.md` documents building from source and says plainly that the bundles are unsigned.
  It has no install section, because there is nothing to install.
- The first outside user is what reverses this. At that point the version numbers, the tag
  trigger and the signing question all arrive together, and this ADR is the thing to supersede.
- CI covering Linux and Windows is what keeps the from-source path honest; there is no build
  artifact whose staleness could hide a break.

## Considered Options

- **Tag-triggered releases now, unsigned**: rejected — it publishes a download whose first
  instruction is how to get past the operating system's warning about it, for an audience of
  one who can already build it.
- **Tag-triggered releases, signed**: rejected — the certificates and per-platform signing
  identities are real recurring cost, and nothing yet needs them.
- **Draft releases now, published later**: rejected — a release path that has never produced a
  release is untested plumbing, and it would still be untested on the day it is first wanted.
