//! Which files differ between the two sides a Diff Mode names -- resolved out of the
//! index, the worktree and the tree of a commit.

use std::collections::{BTreeMap, BTreeSet};

use super::{ChangedFile, Error, Side};
use crate::types::{DiffMode, DiffSpec};

/// The files that differ between the two sides `spec` names.
///
/// | Diff Mode  | old side                          | new side       |
/// |------------|-----------------------------------|----------------|
/// | `Unstaged` | index                             | worktree       |
/// | `Staged`   | HEAD                              | index          |
/// | `Branch`   | merge-base(Base Branch, branch)   | worktree       |
pub fn changed_files(git: &gix::Repository, spec: &DiffSpec) -> Result<Vec<ChangedFile>, Error> {
    let mut files = match spec.diff_mode {
        DiffMode::Unstaged => unstaged(git)?,
        DiffMode::Staged => staged(git)?,
        DiffMode::Branch => branch(git, spec)?,
    };
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

/// Every file the checkout tracks, plus anything `extra` adds (untracked files show up
/// that way). Paths are repo-relative and sorted.
pub fn tracked_paths(git: &gix::Repository, extra: &[String]) -> Result<Vec<String>, Error> {
    let index = git.index_or_empty()?;
    let mut paths: BTreeMap<String, ()> = BTreeMap::new();
    for entry in index.entries() {
        paths.insert(entry.path(&index).to_string(), ());
    }
    for path in extra {
        paths.insert(path.clone(), ());
    }
    Ok(paths.into_keys().collect())
}

/// Rename detection, set explicitly rather than read from the reviewer's git config, so
/// the same Repo produces the same tree on any machine. Copies are not tracked (gix's
/// default), so a `Rewrite` is always a rename.
fn rewrites() -> gix::diff::Rewrites {
    gix::diff::Rewrites::default()
}

/// index vs worktree. Untracked files count as changes: a file the reviewer just wrote
/// is usually the first thing they want to look at, and `git diff`'s habit of hiding it
/// would make Diffnote look broken.
fn unstaged(git: &gix::Repository) -> Result<Vec<ChangedFile>, Error> {
    let root = git
        .workdir()
        .ok_or("This repo has no working tree")?
        .to_owned();
    let iter = git
        .status(gix::progress::Discard)?
        .untracked_files(gix::status::UntrackedFiles::Files)
        .index_worktree_rewrites(Some(rewrites()))
        .into_index_worktree_iter(Vec::new())?;

    let mut out = Vec::new();
    for item in iter {
        use gix::status::index_worktree::Item;
        use gix::status::plumbing::index_as_worktree::{Change, EntryStatus};
        match item? {
            Item::Modification {
                entry,
                rela_path,
                status,
                ..
            } => {
                let path = rela_path.to_string();
                let new = match status {
                    // Only the stat cache is stale -- the content is identical.
                    EntryStatus::NeedsUpdate(_) => continue,
                    EntryStatus::Change(Change::Removed) => Side::Missing,
                    _ => Side::Worktree(root.join(&path)),
                };
                let old = match status {
                    EntryStatus::IntentToAdd => Side::Missing,
                    _ => Side::Blob(entry.id),
                };
                out.push(ChangedFile {
                    path,
                    old_path: None,
                    old,
                    new,
                });
            }
            Item::DirectoryContents { entry, .. } => {
                let path = entry.rela_path.to_string();
                out.push(ChangedFile {
                    path: path.clone(),
                    old_path: None,
                    old: Side::Missing,
                    new: Side::Worktree(root.join(&path)),
                });
            }
            Item::Rewrite {
                source,
                dirwalk_entry,
                ..
            } => {
                use gix::status::index_worktree::RewriteSource;
                // The other variant is only ever produced for copies, which `rewrites()`
                // does not track.
                let RewriteSource::RewriteFromIndex {
                    source_entry,
                    source_rela_path,
                    ..
                } = source
                else {
                    continue;
                };
                let path = dirwalk_entry.rela_path.to_string();
                out.push(ChangedFile {
                    old: Side::Blob(source_entry.id),
                    new: Side::Worktree(root.join(&path)),
                    old_path: Some(source_rela_path.to_string()),
                    path,
                });
            }
        }
    }
    Ok(out)
}

/// HEAD vs index.
fn staged(git: &gix::Repository) -> Result<Vec<ChangedFile>, Error> {
    let head_tree = git.head_tree_id_or_empty()?;
    let index = git.index_or_empty()?;
    let mut out = Vec::new();
    git.tree_index_status(
        &head_tree,
        &index,
        None,
        gix::status::tree_index::TrackRenames::Given(rewrites()),
        |change, _, _| {
            use gix::diff::index::ChangeRef;
            let file = match change {
                ChangeRef::Addition { location, id, .. } => ChangedFile {
                    path: location.to_string(),
                    old_path: None,
                    old: Side::Missing,
                    new: Side::Blob(id.into_owned()),
                },
                ChangeRef::Deletion { location, id, .. } => ChangedFile {
                    path: location.to_string(),
                    old_path: None,
                    old: Side::Blob(id.into_owned()),
                    new: Side::Missing,
                },
                ChangeRef::Modification {
                    location,
                    previous_id,
                    id,
                    ..
                } => ChangedFile {
                    path: location.to_string(),
                    old_path: None,
                    old: Side::Blob(previous_id.into_owned()),
                    new: Side::Blob(id.into_owned()),
                },
                ChangeRef::Rewrite {
                    source_location,
                    source_id,
                    location,
                    id,
                    ..
                } => ChangedFile {
                    path: location.to_string(),
                    old_path: Some(source_location.to_string()),
                    old: Side::Blob(source_id.into_owned()),
                    new: Side::Blob(id.into_owned()),
                },
            };
            out.push(file);
            Ok::<_, std::convert::Infallible>(std::ops::ControlFlow::Continue(()))
        },
    )?;
    Ok(out)
}

/// merge-base(Base Branch, branch) vs the worktree -- everything this branch did,
/// committed or not (ADR 0012), without the commits the Base Branch made after the fork.
fn branch(git: &gix::Repository, spec: &DiffSpec) -> Result<Vec<ChangedFile>, Error> {
    let root = git
        .workdir()
        .ok_or("This repo has no working tree")?
        .to_owned();
    let base_name = spec
        .base_branch
        .as_deref()
        .ok_or("Branch mode needs a Base Branch to compare against")?;
    // ADR 0010: the branch under review is whichever one is checked out, so the worktree
    // is this branch's own new side.
    let tip = git
        .find_reference(spec.branch.as_str())?
        .into_fully_peeled_id()?;
    let base = git.find_reference(base_name)?.into_fully_peeled_id()?;
    let merge_base = git.merge_base(base, tip)?;
    let merge_base_tree = git.find_commit(merge_base.detach())?.tree()?;

    // One walk over merge-base tree -> index -> worktree, but it arrives as two kinds of
    // event in no guaranteed order, and it never fuses them: a file changed in a commit
    // *and* again in the worktree shows up twice. So the events are read for the paths
    // that took part and nothing else -- each side's content is resolved below, from the
    // merge-base tree and from the worktree, which is what makes a path land once.
    let iter = git
        .status(gix::progress::Discard)?
        .head_tree(merge_base_tree.id)
        .untracked_files(gix::status::UntrackedFiles::Files)
        .index_worktree_rewrites(Some(rewrites()))
        .tree_index_track_renames(gix::status::tree_index::TrackRenames::Given(rewrites()))
        .into_iter(Vec::new())?;

    let mut paths: BTreeSet<String> = BTreeSet::new();
    // Where a path came from, for the leg that renamed it.
    let mut sources: BTreeMap<String, String> = BTreeMap::new();
    for item in iter {
        match item? {
            gix::status::Item::TreeIndex(change) => {
                use gix::diff::index::ChangeRef;
                match change {
                    ChangeRef::Addition { location, .. }
                    | ChangeRef::Deletion { location, .. }
                    | ChangeRef::Modification { location, .. } => {
                        paths.insert(location.to_string());
                    }
                    ChangeRef::Rewrite {
                        source_location,
                        location,
                        ..
                    } => {
                        let path = location.to_string();
                        sources.insert(path.clone(), source_location.to_string());
                        paths.insert(path);
                    }
                }
            }
            gix::status::Item::IndexWorktree(item) => {
                use gix::status::index_worktree::Item;
                use gix::status::plumbing::index_as_worktree::EntryStatus;
                match item {
                    // Only the stat cache is stale -- the content is the index's, so
                    // whether it differs from the merge-base is the tree leg's to say.
                    Item::Modification {
                        status: EntryStatus::NeedsUpdate(_),
                        ..
                    } => {}
                    Item::Modification { rela_path, .. } => {
                        paths.insert(rela_path.to_string());
                    }
                    Item::DirectoryContents { entry, .. } => {
                        paths.insert(entry.rela_path.to_string());
                    }
                    Item::Rewrite {
                        source,
                        dirwalk_entry,
                        ..
                    } => {
                        use gix::status::index_worktree::RewriteSource;
                        // The other variant is only ever produced for copies, which
                        // `rewrites()` does not track.
                        let RewriteSource::RewriteFromIndex {
                            source_rela_path, ..
                        } = source
                        else {
                            continue;
                        };
                        let path = dirwalk_entry.rela_path.to_string();
                        sources.insert(path.clone(), source_rela_path.to_string());
                        paths.insert(path);
                    }
                }
            }
        }
    }

    let mut out = Vec::new();
    for path in paths {
        let origin = origin_of(&path, &sources);
        let old = match merge_base_tree.lookup_entry_by_path(&origin)? {
            Some(entry) if entry.mode().is_blob_or_symlink() => Side::Blob(entry.object_id()),
            _ => Side::Missing,
        };
        let full = root.join(&path);
        // `symlink_metadata` rather than `exists`, so a symlink still counts as present
        // when it points at nothing. A directory here is a submodule, which Diffnote can no
        // more show a diff for than the tree-to-tree walk could.
        let new = match std::fs::symlink_metadata(&full) {
            Ok(meta) if !meta.is_dir() => Side::Worktree(full),
            _ => Side::Missing,
        };
        // Neither side has content: a file this branch added and the worktree has since
        // removed, or a submodule, which has none either way.
        if matches!((&old, &new), (Side::Missing, Side::Missing)) {
            continue;
        }
        out.push(ChangedFile {
            old_path: (origin != path).then(|| origin.clone()),
            path,
            old,
            new,
        });
    }
    Ok(out)
}

/// The path a file had in the merge-base. A rename can be recorded on either leg -- one
/// the branch committed, or one done in the worktree since -- so the sources are followed
/// back. The bound is what keeps a rename that loops back on itself from spinning.
fn origin_of(path: &str, sources: &BTreeMap<String, String>) -> String {
    let mut origin = path;
    for _ in 0..sources.len() {
        match sources.get(origin) {
            Some(source) => origin = source,
            None => break,
        }
    }
    origin.to_string()
}

#[cfg(test)]
mod tests {
    use super::{changed_files, tracked_paths};
    use crate::diff::fixtures::{commit_a_big_file, spec};
    use crate::diff::Side;
    use crate::test_repo::{git, open, repo_with_a_commit, write, DATE};
    use crate::types::{DiffMode, DiffSpec};

    fn paths_of(git: &gix::Repository, spec: &DiffSpec) -> Vec<String> {
        changed_files(git, spec)
            .expect("changed files")
            .into_iter()
            .map(|file| file.path)
            .collect()
    }

    #[test]
    fn unstaged_lists_a_file_edited_in_the_worktree() {
        let dir = tempfile::tempdir().expect("tempdir");
        repo_with_a_commit(dir.path());
        write(dir.path(), "file.txt", "one\nCHANGED\nthree\n");

        let found = paths_of(&open(dir.path()), &spec(DiffMode::Unstaged, None));
        assert_eq!(found, ["file.txt"]);
    }

    /// `git diff` hides untracked files. A review tool that hid the file the reviewer
    /// just wrote would look broken, so Diffnote lists it.
    #[test]
    fn unstaged_lists_an_untracked_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        repo_with_a_commit(dir.path());
        write(dir.path(), "brand-new.txt", "hello\n");

        let found = paths_of(&open(dir.path()), &spec(DiffMode::Unstaged, None));
        assert_eq!(found, ["brand-new.txt"]);
    }

    #[test]
    fn unstaged_leaves_out_an_ignored_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        repo_with_a_commit(dir.path());
        write(dir.path(), ".gitignore", "secret.txt\n");
        git(dir.path(), DATE, &["add", ".gitignore"]);
        git(dir.path(), DATE, &["commit", "-m", "ignore"]);
        write(dir.path(), "secret.txt", "shh\n");

        let found = paths_of(&open(dir.path()), &spec(DiffMode::Unstaged, None));
        assert!(!found.contains(&"secret.txt".to_string()), "got: {found:?}");
    }

    #[test]
    fn unstaged_reports_a_deleted_file_as_missing_on_the_new_side() {
        let dir = tempfile::tempdir().expect("tempdir");
        repo_with_a_commit(dir.path());
        std::fs::remove_file(dir.path().join("file.txt")).expect("remove");

        let files = changed_files(&open(dir.path()), &spec(DiffMode::Unstaged, None)).expect("ok");
        assert!(matches!(files[0].new, Side::Missing));
    }

    #[test]
    fn staged_lists_only_what_was_added_to_the_index() {
        let dir = tempfile::tempdir().expect("tempdir");
        repo_with_a_commit(dir.path());
        write(dir.path(), "staged.txt", "staged\n");
        git(dir.path(), DATE, &["add", "staged.txt"]);
        write(dir.path(), "loose.txt", "not staged\n");

        let found = paths_of(&open(dir.path()), &spec(DiffMode::Staged, None));
        assert_eq!(found, ["staged.txt"]);
    }

    #[test]
    fn staged_leaves_out_an_untracked_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        repo_with_a_commit(dir.path());
        write(dir.path(), "brand-new.txt", "hello\n");

        let found = paths_of(&open(dir.path()), &spec(DiffMode::Staged, None));
        assert!(found.is_empty(), "got: {found:?}");
    }

    /// Branch mode compares against the merge base, not the Base Branch tip: work the
    /// Base Branch picked up after the fork isn't this branch's to answer for.
    #[test]
    fn branch_ignores_commits_the_base_branch_made_after_the_fork() {
        let dir = tempfile::tempdir().expect("tempdir");
        repo_with_a_commit(dir.path());
        git(dir.path(), DATE, &["checkout", "-b", "feature"]);
        write(dir.path(), "mine.txt", "my work\n");
        git(dir.path(), DATE, &["add", "."]);
        git(dir.path(), DATE, &["commit", "-m", "my work"]);

        git(dir.path(), DATE, &["checkout", "main"]);
        write(dir.path(), "theirs.txt", "their work\n");
        git(dir.path(), DATE, &["add", "."]);
        git(dir.path(), DATE, &["commit", "-m", "their work"]);
        git(dir.path(), DATE, &["checkout", "feature"]);

        let mut spec = spec(DiffMode::Branch, Some("main"));
        spec.branch = "feature".into();
        let found = paths_of(&open(dir.path()), &spec);
        assert_eq!(found, ["mine.txt"]);
    }

    /// ADR 0012: Branch mode's new side is the worktree, so work that is done but not
    /// committed -- the part most likely to need a second look -- is in the diff.
    #[test]
    fn branch_lists_a_change_that_is_not_committed_yet() {
        let dir = tempfile::tempdir().expect("tempdir");
        repo_with_a_commit(dir.path());
        git(dir.path(), DATE, &["checkout", "-b", "feature"]);
        write(dir.path(), "file.txt", "one\nCHANGED\nthree\n");

        let mut spec = spec(DiffMode::Branch, Some("main"));
        spec.branch = "feature".into();
        let found = paths_of(&open(dir.path()), &spec);
        assert_eq!(found, ["file.txt"]);
    }

    #[test]
    fn branch_lists_a_file_that_was_never_added_to_the_index() {
        let dir = tempfile::tempdir().expect("tempdir");
        repo_with_a_commit(dir.path());
        git(dir.path(), DATE, &["checkout", "-b", "feature"]);
        write(dir.path(), "brand-new.txt", "hello\n");

        let mut spec = spec(DiffMode::Branch, Some("main"));
        spec.branch = "feature".into();
        let found = paths_of(&open(dir.path()), &spec);
        assert_eq!(found, ["brand-new.txt"]);
    }

    /// The status walk reports merge-base-to-index and index-to-worktree as separate
    /// events and never fuses them, so a file changed on both legs arrives twice. It has
    /// to come out as one file spanning the whole distance -- merge-base to worktree --
    /// rather than one of the two halves.
    #[test]
    fn branch_spans_a_file_changed_in_a_commit_and_again_in_the_worktree() {
        let dir = tempfile::tempdir().expect("tempdir");
        repo_with_a_commit(dir.path());
        git(dir.path(), DATE, &["checkout", "-b", "feature"]);
        write(dir.path(), "file.txt", "one\nCOMMITTED\nthree\n");
        git(dir.path(), DATE, &["add", "."]);
        git(dir.path(), DATE, &["commit", "-m", "committed"]);
        write(dir.path(), "file.txt", "one\nCOMMITTED\nWORKTREE\n");

        let mut spec = spec(DiffMode::Branch, Some("main"));
        spec.branch = "feature".into();
        let git_repo = open(dir.path());
        let files = changed_files(&git_repo, &spec).expect("ok");

        assert_eq!(
            files.iter().map(|file| &file.path).collect::<Vec<_>>(),
            ["file.txt"]
        );
        let read =
            |side: &Side| String::from_utf8(side.read(&git_repo).expect("read")).expect("utf-8");
        assert_eq!(read(&files[0].old), "one\ntwo\nthree\n");
        assert_eq!(read(&files[0].new), "one\nCOMMITTED\nWORKTREE\n");
    }

    /// A file this branch added and then removed again from the worktree is on neither
    /// side of the comparison, so it is not a change to show.
    #[test]
    fn branch_leaves_out_a_file_it_added_and_the_worktree_has_since_deleted() {
        let dir = tempfile::tempdir().expect("tempdir");
        repo_with_a_commit(dir.path());
        git(dir.path(), DATE, &["checkout", "-b", "feature"]);
        write(dir.path(), "scratch.txt", "throwaway\n");
        git(dir.path(), DATE, &["add", "."]);
        git(dir.path(), DATE, &["commit", "-m", "scratch"]);
        std::fs::remove_file(dir.path().join("scratch.txt")).expect("remove");

        let mut spec = spec(DiffMode::Branch, Some("main"));
        spec.branch = "feature".into();
        let found = paths_of(&open(dir.path()), &spec);
        assert!(found.is_empty(), "got: {found:?}");
    }

    /// A tree-to-index diff reports the directories a change sits in as well. Left in,
    /// `src` would arrive as a file and collide with the directory of the same name.
    #[test]
    fn branch_leaves_out_the_directories_a_changed_file_sits_in() {
        let dir = tempfile::tempdir().expect("tempdir");
        repo_with_a_commit(dir.path());
        git(dir.path(), DATE, &["checkout", "-b", "feature"]);
        write(dir.path(), "src/deep/main.rs", "fn main() {}\n");
        git(dir.path(), DATE, &["add", "."]);
        git(dir.path(), DATE, &["commit", "-m", "nested"]);

        let mut spec = spec(DiffMode::Branch, Some("main"));
        spec.branch = "feature".into();
        let found = paths_of(&open(dir.path()), &spec);
        assert_eq!(found, ["src/deep/main.rs"]);
    }

    #[test]
    fn unstaged_reports_a_moved_file_once_under_its_new_path() {
        let dir = tempfile::tempdir().expect("tempdir");
        repo_with_a_commit(dir.path());
        commit_a_big_file(dir.path(), "big.txt");
        std::fs::rename(dir.path().join("big.txt"), dir.path().join("moved.txt")).expect("mv");

        let found = paths_of(&open(dir.path()), &spec(DiffMode::Unstaged, None));
        assert_eq!(found, ["moved.txt"]);
    }

    #[test]
    fn unstaged_says_where_a_moved_file_came_from() {
        let dir = tempfile::tempdir().expect("tempdir");
        repo_with_a_commit(dir.path());
        commit_a_big_file(dir.path(), "big.txt");
        std::fs::rename(dir.path().join("big.txt"), dir.path().join("moved.txt")).expect("mv");

        let files = changed_files(&open(dir.path()), &spec(DiffMode::Unstaged, None)).expect("ok");
        assert_eq!(files[0].old_path.as_deref(), Some("big.txt"));
    }

    #[test]
    fn staged_says_where_a_moved_file_came_from() {
        let dir = tempfile::tempdir().expect("tempdir");
        repo_with_a_commit(dir.path());
        commit_a_big_file(dir.path(), "big.txt");
        git(dir.path(), DATE, &["mv", "big.txt", "moved.txt"]);

        let files = changed_files(&open(dir.path()), &spec(DiffMode::Staged, None)).expect("ok");
        assert_eq!(
            (files[0].path.as_str(), files[0].old_path.as_deref()),
            ("moved.txt", Some("big.txt"))
        );
    }

    #[test]
    fn branch_says_where_a_moved_file_came_from() {
        let dir = tempfile::tempdir().expect("tempdir");
        repo_with_a_commit(dir.path());
        commit_a_big_file(dir.path(), "big.txt");
        git(dir.path(), DATE, &["checkout", "-b", "feature"]);
        git(dir.path(), DATE, &["mv", "big.txt", "moved.txt"]);
        git(dir.path(), DATE, &["commit", "-m", "rename"]);

        let mut spec = spec(DiffMode::Branch, Some("main"));
        spec.branch = "feature".into();
        let files = changed_files(&open(dir.path()), &spec).expect("ok");
        assert_eq!(
            (files[0].path.as_str(), files[0].old_path.as_deref()),
            ("moved.txt", Some("big.txt"))
        );
    }

    #[test]
    fn tracked_paths_lists_files_that_did_not_change() {
        let dir = tempfile::tempdir().expect("tempdir");
        repo_with_a_commit(dir.path());

        let found = tracked_paths(&open(dir.path()), &[]).expect("tracked");
        assert_eq!(found, ["file.txt"]);
    }

    #[test]
    fn tracked_paths_carries_in_a_path_the_index_no_longer_has() {
        let dir = tempfile::tempdir().expect("tempdir");
        repo_with_a_commit(dir.path());

        let found = tracked_paths(&open(dir.path()), &["gone.txt".into()]).expect("tracked");
        assert_eq!(found, ["file.txt", "gone.txt"]);
    }
}
