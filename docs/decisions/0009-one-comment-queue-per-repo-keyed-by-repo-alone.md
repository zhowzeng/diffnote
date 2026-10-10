# One Comment Queue per Repo, keyed by the Repo alone

A [[Comment Queue]] belongs to one [[Repo]]: switching Repo swaps the queue, and a comment is only ever handed off alongside others from the Repo it was written in. Before this, one global list spanned every Repo, which was invisible while the Repo list was mocked and became wrong the moment reviewers could add real ones — `formatForAgent` emits a repo-relative `path:L12`, so a comment written against another Repo's `Cargo.toml` resolves against the current one and the agent silently edits the wrong file. The key is the Repo and nothing else: Branch and [[Diff Mode]] deliberately don't key the queue, because one review routinely moves between Unstaged and Branch mode over the same work, and splitting the queue along that axis would fragment a single sitting (ADR 0001) into several.

## Consequences

- Queues for Repos the reviewer has switched away from stay in memory and come back on return — they still don't survive closing the app, so ADR 0006 is unchanged. Removing a Repo takes its queue with it, and says how many unsent comments that discards when there are any.
- Because a queue now has an owner, the queue drawer names its Repo. Without that, switching Repo just makes comments vanish from the drawer — the correct behavior looking exactly like the bug it replaced.
- Switching Branch can still leave an anchor pointing at different content, the same failure shape this decision fixes across Repos. That was a `formatForAgent` problem — what `path:L12` means when the selected Branch isn't what's checked out (Diffnote never checks out; ADR 0003) — tracked on its own rather than papered over by the queue's key, and ADR 0010 settled it: the Branch under review is the checked-out one, so there is no longer a Branch to switch to that the worktree doesn't have.

## Considered Options

- **One global queue spanning Repos** (the behavior this replaces): rejected — relative paths plus a bulk "copy all" hand the agent comments meant for a different Repo, with nothing anywhere to catch it.
- **Global queue, grouped by Repo in the drawer, absolute paths in the hand-off**: rejected — it makes "one hand-off covering several Repos" a supported scenario. ADR 0001's model is one sitting handed to one agent, and no reviewer has asked for the multi-Repo version.
- **Clear the queue when the Repo changes**: rejected — it keeps one global list at the price of silently throwing away work the reviewer can't get back by switching Repo again.
- **Key by Repo + Branch**: rejected for the fragmentation reason above.
