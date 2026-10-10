//! The Repo's branches: what is checked out, what the Base Branch picker offers, and
//! how far each branch has drifted from its upstream. `fetch_remote` lives here because
//! refreshing the remote refs is what makes those ahead/behind counts current.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::time::Duration;

use gix::remote::fetch::refs::update;

use super::paths::repo_root;
use crate::types::{Branch, BranchList, FetchResult};

#[tauri::command]
pub fn list_branches(app: tauri::AppHandle, repo_id: String) -> Result<BranchList, String> {
    let root = repo_root(&app, &repo_id)?;
    let git = gix::open(&root).map_err(|e| format!("Cannot open {}: {e}", root.display()))?;
    read_branches(&git).map_err(|e| format!("Cannot list branches: {e}"))
}

/// The Repo's local branches, most recently committed first.
///
/// Recency rather than alphabetical order: this list is the Base Branch picker, and the
/// branch a reviewer wants to compare against is far more likely to be one they have
/// touched than one whose name sorts early. Remote-tracking branches are deliberately
/// left out for now -- see the issue this came from.
fn read_branches(
    git: &gix::Repository,
) -> Result<BranchList, Box<dyn std::error::Error + Send + Sync>> {
    let head = git.head_name()?;
    let current = head.as_ref().map(|name| name.shorten().to_string());

    let mut rows = Vec::new();
    for reference in git.references()?.local_branches()? {
        let mut reference = reference?;
        let name = reference.name().shorten().to_string();
        let tip = reference.peel_to_id()?.detach();
        let committed_at = git.find_commit(tip)?.time()?.seconds;
        let (ahead, behind) = upstream_gap(git, &reference, tip);
        rows.push((
            committed_at,
            Branch {
                is_current: current.as_deref() == Some(name.as_str()),
                name,
                ahead,
                behind,
            },
        ));
    }
    rows.sort_by(|(a_time, a), (b_time, b)| b_time.cmp(a_time).then_with(|| a.name.cmp(&b.name)));

    Ok(BranchList {
        branches: rows.into_iter().map(|(_, branch)| branch).collect(),
        // A detached HEAD is on no branch at all, so every `is_current` above is false
        // and the frontend needs this to say what is checked out instead.
        detached_head: match head {
            Some(_) => None,
            None => Some(git.head_id()?.shorten_or_id().to_string()),
        },
    })
}

/// Commits each side has that the other does not, or `(None, None)` when the branch has
/// no upstream -- "nothing to compare" and "in sync" are different answers.
fn upstream_gap(
    git: &gix::Repository,
    reference: &gix::Reference<'_>,
    tip: gix::ObjectId,
) -> (Option<u32>, Option<u32>) {
    let Some(Ok(upstream_name)) = reference.remote_tracking_ref_name(gix::remote::Direction::Fetch)
    else {
        return (None, None);
    };
    // The name is derived from the refspec, so it can name a ref that was never fetched.
    let Ok(mut upstream) = git.find_reference(upstream_name.as_ref()) else {
        return (None, None);
    };
    let Ok(upstream_tip) = upstream.peel_to_id() else {
        return (None, None);
    };
    let upstream_tip = upstream_tip.detach();
    (
        count_commits(git, tip, upstream_tip),
        count_commits(git, upstream_tip, tip),
    )
}

/// `git rev-list --count <hidden>..<tip>`.
fn count_commits(git: &gix::Repository, tip: gix::ObjectId, hidden: gix::ObjectId) -> Option<u32> {
    let walk = git
        .rev_walk(Some(tip))
        .with_hidden(Some(hidden))
        .all()
        .ok()?;
    let mut count = 0;
    for info in walk {
        info.ok()?;
        count += 1;
    }
    Some(count)
}

/// How long a `Fetch` may run before Redline gives up on it.
///
/// ADR 0003 accepted that fetching goes through the system `ssh` binary, which Redline does
/// not control: it can sit waiting on a passphrase or a host-key prompt this app has no
/// way to answer. A spinner that never stops is the worst answer to give a reviewer, so
/// the fetch is abandoned instead.
const FETCH_TIMEOUT: Duration = Duration::from_secs(60);

#[tauri::command]
pub fn fetch_remote(app: tauri::AppHandle, repo_id: String) -> Result<FetchResult, String> {
    let root = repo_root(&app, &repo_id)?;
    Ok(fetch_within_timeout(root))
}

/// Runs the fetch on its own thread so a hung one can be abandoned.
///
/// The abandoned fetch keeps running until it next reads `should_interrupt` -- a thread
/// blocked on a prompt cannot be killed -- but the reviewer gets an answer either way.
fn fetch_within_timeout(root: PathBuf) -> FetchResult {
    let should_interrupt = Arc::new(AtomicBool::new(false));
    let (sender, receiver) = mpsc::channel();
    let interrupt = Arc::clone(&should_interrupt);
    std::thread::spawn(move || {
        let _ = sender.send(fetch_from_remote(&root, &interrupt));
    });

    match receiver.recv_timeout(FETCH_TIMEOUT) {
        Ok(Ok(message)) => FetchResult {
            success: true,
            message,
        },
        Ok(Err(message)) => FetchResult {
            success: false,
            message,
        },
        Err(mpsc::RecvTimeoutError::Timeout) => {
            should_interrupt.store(true, Ordering::Relaxed);
            FetchResult {
                success: false,
                message: format!(
                    "Gave up after {}s. The remote may be unreachable, or it asked for \
                     credentials Redline cannot prompt for.",
                    FETCH_TIMEOUT.as_secs()
                ),
            }
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => FetchResult {
            success: false,
            message: "Fetch stopped unexpectedly.".into(),
        },
    }
}

/// Opens the Repo with someone to name in the reflog.
///
/// gix writes a reflog entry for every remote ref a fetch moves, and refuses to compose
/// one without a committer identity -- stricter than `git fetch`, which needs none. So a
/// reviewer who never ran `git config user.name` could not fetch at all. The fallback is
/// only reached when git itself has nobody to name; a configured identity still wins.
fn open_for_fetch(root: &Path) -> Result<gix::Repository, String> {
    let mut git = gix::open(root).map_err(|e| format!("Cannot open {}: {e}", root.display()))?;
    git.committer_or_set_generic_fallback()
        .map_err(|e| explain("Cannot work out who to record the fetch as", &e))?;
    Ok(git)
}

/// Fetches from the remote `git fetch` itself would pick: the checked-out branch's
/// remote, or the only one configured. Returns what to tell the reviewer, whether it
/// worked or not.
fn fetch_from_remote(root: &Path, should_interrupt: &AtomicBool) -> Result<String, String> {
    let git = open_for_fetch(root)?;
    // A Repo that was never cloned from anywhere has nothing to fetch. That is an
    // ordinary state for a local repo, not a failure.
    if git.remote_names().is_empty() {
        return Ok("This repo has no remote, so there is nothing to fetch.".into());
    }
    let remote = git
        .find_fetch_remote(None)
        .map_err(|e| explain("Cannot tell which remote to fetch from", &e))?;

    let (url, _) = remote
        .sanitized_url_and_version(gix::remote::Direction::Fetch)
        .map_err(|e| explain("Cannot tell where to fetch from", &e))?;
    // ADR 0011: Redline is built without an HTTP transport, so say that in the reviewer's
    // terms. gix's own answer names cargo features, which is no help from inside the app.
    if matches!(url.scheme, gix::url::Scheme::Https | gix::url::Scheme::Http) {
        return Err(format!(
            "Redline fetches over ssh only, and this repo's remote is {url}. Pointing it at \
             the ssh form of the same repo (git remote set-url) makes Fetch work."
        ));
    }

    let outcome = remote
        .connect(gix::remote::Direction::Fetch)
        .map_err(|e| explain("Cannot reach the remote", &e))?
        .prepare_fetch(gix::progress::Discard, Default::default())
        .map_err(|e| explain("Cannot start the fetch", &e))?
        .receive(gix::progress::Discard, should_interrupt)
        .map_err(|e| explain("Fetch failed", &e))?;

    Ok(summarize(&outcome.status))
}

/// A gix error together with its causes: the outermost message is usually the vaguest
/// one ("Fetch failed"), and the reviewer needs the layer that names the real problem.
fn explain(context: &str, error: &dyn std::error::Error) -> String {
    let mut message = format!("{context}: {error}");
    let mut cause = error.source();
    while let Some(error) = cause {
        message.push_str(&format!(": {error}"));
        cause = error.source();
    }
    message
}

/// What changed, in the terms the reviewer cares about: which refs moved, and how.
fn summarize(status: &gix::remote::fetch::Status) -> String {
    let refs = match status {
        gix::remote::fetch::Status::NoPackReceived { update_refs, .. }
        | gix::remote::fetch::Status::Change { update_refs, .. } => update_refs,
    };
    let mut moved: Vec<String> = refs
        .updates
        .iter()
        .filter(|update| !matches!(update.mode, update::Mode::NoChangeNeeded))
        .filter_map(|update| {
            let edit = refs.edits.get(update.edit_index?)?;
            Some(format!("{} ({})", edit.name.shorten(), update.mode))
        })
        .collect();

    if moved.is_empty() {
        return "Already up to date.".into();
    }
    let total = moved.len();
    // A toast is not a log: past a few refs the count says more than the names would.
    moved.truncate(3);
    if total > moved.len() {
        format!("Updated {total} refs: {}, ...", moved.join(", "))
    } else {
        format!("Updated {}", moved.join(", "))
    }
}

#[cfg(test)]
mod tests {
    use super::{fetch_from_remote, read_branches};
    use crate::test_repo::{git, open, repo_with_a_commit, DATE};
    use std::sync::atomic::AtomicBool;

    /// Fetches the way the command does, minus the timeout wrapper.
    fn fetch(root: &std::path::Path) -> Result<String, String> {
        fetch_from_remote(root, &AtomicBool::new(false))
    }

    #[test]
    fn read_branches_marks_the_checked_out_branch_as_current() {
        let dir = tempfile::tempdir().expect("tempdir");
        repo_with_a_commit(dir.path());
        git(dir.path(), DATE, &["branch", "other"]);

        let list = read_branches(&open(dir.path())).expect("should read");
        let current: Vec<_> = list
            .branches
            .iter()
            .filter(|b| b.is_current)
            .map(|b| b.name.as_str())
            .collect();
        assert_eq!(current, ["main"]);
    }

    /// The gap ADR 0010 left open: with no branch checked out, nothing may be reported
    /// as current, or the topbar would name a branch the reviewer is not on.
    #[test]
    fn read_branches_marks_nothing_as_current_when_head_is_detached() {
        let dir = tempfile::tempdir().expect("tempdir");
        repo_with_a_commit(dir.path());
        git(dir.path(), DATE, &["checkout", "--detach"]);

        let list = read_branches(&open(dir.path())).expect("should read");
        assert!(!list.branches.iter().any(|b| b.is_current));
    }

    #[test]
    fn read_branches_names_the_commit_a_detached_head_sits_on() {
        let dir = tempfile::tempdir().expect("tempdir");
        repo_with_a_commit(dir.path());
        git(dir.path(), DATE, &["checkout", "--detach"]);

        let list = read_branches(&open(dir.path())).expect("should read");
        assert!(list.detached_head.is_some());
    }

    #[test]
    fn read_branches_reports_no_detached_head_while_on_a_branch() {
        let dir = tempfile::tempdir().expect("tempdir");
        repo_with_a_commit(dir.path());

        let list = read_branches(&open(dir.path())).expect("should read");
        assert_eq!(list.detached_head, None);
    }

    #[test]
    fn read_branches_puts_the_most_recently_committed_branch_first() {
        let dir = tempfile::tempdir().expect("tempdir");
        repo_with_a_commit(dir.path());
        git(
            dir.path(),
            "2021-06-01T00:00:00Z",
            &["checkout", "-b", "newer"],
        );
        std::fs::write(dir.path().join("file.txt"), "two\n").expect("write");
        git(
            dir.path(),
            "2021-06-01T00:00:00Z",
            &["commit", "-am", "second"],
        );

        let list = read_branches(&open(dir.path())).expect("should read");
        let names: Vec<_> = list.branches.iter().map(|b| b.name.as_str()).collect();
        assert_eq!(names, ["newer", "main"]);
    }

    /// "No upstream" and "in sync" are different answers, so a branch with nothing to
    /// compare against must not report 0.
    #[test]
    fn read_branches_reports_no_counts_for_a_branch_without_an_upstream() {
        let dir = tempfile::tempdir().expect("tempdir");
        repo_with_a_commit(dir.path());

        let list = read_branches(&open(dir.path())).expect("should read");
        assert_eq!(
            (list.branches[0].ahead, list.branches[0].behind),
            (None, None)
        );
    }

    /// A clone, so `branch.main.merge` and `refs/remotes/origin/main` are set up the
    /// way they are for a repo a reviewer actually works in.
    fn clone_with_upstream(root: &std::path::Path) -> std::path::PathBuf {
        let origin = root.join("origin");
        std::fs::create_dir(&origin).expect("create origin");
        repo_with_a_commit(&origin);

        let clone = root.join("clone");
        git(
            root,
            DATE,
            &["clone", &origin.to_string_lossy(), &clone.to_string_lossy()],
        );
        clone
    }

    #[test]
    fn read_branches_counts_commits_ahead_of_the_upstream() {
        let dir = tempfile::tempdir().expect("tempdir");
        let clone = clone_with_upstream(dir.path());
        std::fs::write(clone.join("file.txt"), "local\n").expect("write");
        git(
            &clone,
            "2020-02-01T00:00:00Z",
            &["commit", "-am", "local work"],
        );

        let list = read_branches(&open(&clone)).expect("should read");
        assert_eq!(list.branches[0].ahead, Some(1));
    }

    #[test]
    fn read_branches_counts_commits_behind_the_upstream() {
        let dir = tempfile::tempdir().expect("tempdir");
        let clone = clone_with_upstream(dir.path());
        let origin = dir.path().join("origin");
        std::fs::write(origin.join("file.txt"), "remote\n").expect("write");
        git(
            &origin,
            "2020-02-01T00:00:00Z",
            &["commit", "-am", "remote work"],
        );
        git(&clone, "2020-02-01T00:00:00Z", &["fetch"]);

        let list = read_branches(&open(&clone)).expect("should read");
        assert_eq!(list.branches[0].behind, Some(1));
    }

    /// Pressing Fetch on a repo that was never cloned from anywhere is not a mistake,
    /// so it must not come back as an error.
    #[test]
    fn fetch_reports_nothing_to_do_for_a_repo_without_a_remote() {
        let dir = tempfile::tempdir().expect("tempdir");
        repo_with_a_commit(dir.path());

        let message = fetch(dir.path()).expect("should not fail");
        assert_eq!(
            message,
            "This repo has no remote, so there is nothing to fetch."
        );
    }

    /// The gap that let a green local run push a red CI: a machine with no git identity
    /// configured could not fetch at all, because the reflog entry had nobody to name.
    /// Asserting on the prepared repo holds either way, identity configured or not.
    #[test]
    fn a_repo_opened_for_fetch_has_a_committer_for_the_reflog() {
        let dir = tempfile::tempdir().expect("tempdir");
        repo_with_a_commit(dir.path());

        let git = super::open_for_fetch(dir.path()).expect("should open");
        assert!(git.committer().is_some());
    }

    /// gix's own answer here names cargo features, which means nothing to a reviewer
    /// looking at a repo they cloned over HTTPS.
    #[test]
    fn fetch_explains_itself_when_the_remote_is_an_https_url() {
        let dir = tempfile::tempdir().expect("tempdir");
        repo_with_a_commit(dir.path());
        git(
            dir.path(),
            DATE,
            &[
                "remote",
                "add",
                "origin",
                "https://github.com/zhowzeng/ziff.git",
            ],
        );

        let message = fetch(dir.path()).expect_err("should refuse");
        assert!(
            message.starts_with("Redline fetches over ssh only,"),
            "got: {message}"
        );
    }

    #[test]
    fn fetch_says_so_when_the_remote_has_not_moved() {
        let dir = tempfile::tempdir().expect("tempdir");
        let clone = clone_with_upstream(dir.path());

        let message = fetch(&clone).expect("should fetch");
        assert_eq!(message, "Already up to date.");
    }

    #[test]
    fn fetch_names_the_refs_it_moved() {
        let dir = tempfile::tempdir().expect("tempdir");
        let clone = clone_with_upstream(dir.path());
        let origin = dir.path().join("origin");
        std::fs::write(origin.join("file.txt"), "remote\n").expect("write");
        git(
            &origin,
            "2020-02-01T00:00:00Z",
            &["commit", "-am", "remote work"],
        );

        let message = fetch(&clone).expect("should fetch");
        assert_eq!(message, "Updated origin/main (fast-forward)");
    }

    /// Why Fetch exists at all: the counts the topbar shows are only as current as the
    /// remote refs behind them.
    #[test]
    fn fetch_updates_the_counts_the_branch_list_reports() {
        let dir = tempfile::tempdir().expect("tempdir");
        let clone = clone_with_upstream(dir.path());
        let origin = dir.path().join("origin");
        std::fs::write(origin.join("file.txt"), "remote\n").expect("write");
        git(
            &origin,
            "2020-02-01T00:00:00Z",
            &["commit", "-am", "remote work"],
        );
        assert_eq!(
            read_branches(&open(&clone)).expect("should read").branches[0].behind,
            Some(0)
        );

        fetch(&clone).expect("should fetch");

        let list = read_branches(&open(&clone)).expect("should read");
        assert_eq!(list.branches[0].behind, Some(1));
    }
}
