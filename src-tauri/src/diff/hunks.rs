//! How one file differs: the +/- counts the sidebar shows, and the line-level hunks the
//! diff view renders. Everything here works in lines of text read out of a
//! [`ChangedFile`](super::ChangedFile)'s two sides.

use gix::diff::blob::{Algorithm, Diff, Hunk, InternedInput, Token};

use super::{ChangedFile, Error};
use crate::types::{Changes, DiffHunk, DiffLine, FileDiff, LineKind};

/// Unchanged lines shown either side of a change. git's default; Settings has no place
/// to put the choice yet, so it is not configurable.
const CONTEXT_LINES: u32 = 3;

/// How many lines were added and deleted between the two sides.
///
/// A file neither side can decode as UTF-8 has no lines to count, so it reports zero of
/// each while still being listed as changed.
pub fn count_changes(git: &gix::Repository, file: &ChangedFile) -> Result<Changes, Error> {
    let old = file.old.read(git)?;
    let new = file.new.read(git)?;
    let (Ok(old), Ok(new)) = (std::str::from_utf8(&old), std::str::from_utf8(&new)) else {
        return Ok(Changes { add: 0, del: 0 });
    };
    let input = gix::diff::blob::InternedInput::new(old, new);
    // Slider heuristics move hunk boundaries to where a human would put them, which is
    // also where git puts them.
    let diff =
        gix::diff::blob::diff_with_slider_heuristics(gix::diff::blob::Algorithm::Histogram, &input);
    Ok(Changes {
        add: diff.count_additions(),
        del: diff.count_removals(),
    })
}

/// The line-level diff of one file, as hunks the frontend renders directly.
///
/// The numbers are the point of this: `old_no` / `new_no` are what a Comment anchors to,
/// and a del line carries no `new_no` at all -- the worktree does not have that line, so
/// there is nothing for `path:L12` to resolve against (ADR 0010).
pub fn file_diff(git: &gix::Repository, file: &ChangedFile) -> Result<FileDiff, Error> {
    let old = file.old.read(git)?;
    let new = file.new.read(git)?;
    let (Ok(old), Ok(new)) = (std::str::from_utf8(&old), std::str::from_utf8(&new)) else {
        return Ok(FileDiff {
            hunks: Vec::new(),
            binary: true,
            old_text: String::new(),
            new_text: String::new(),
        });
    };
    let input = InternedInput::new(old, new);
    // Same algorithm and heuristics as `count_changes`, so the hunks shown and the
    // +/- counts in the sidebar can't tell different stories about the same file.
    let diff = gix::diff::blob::diff_with_slider_heuristics(Algorithm::Histogram, &input);
    Ok(FileDiff {
        hunks: hunks(&input, &diff),
        binary: false,
        old_text: old.to_string(),
        new_text: new.to_string(),
    })
}

/// Groups the changed ranges into hunks the way git does: two changes whose context
/// lines would touch are one hunk, not two with a gap of repeated lines between them.
fn hunks(input: &InternedInput<&str>, diff: &Diff) -> Vec<DiffHunk> {
    let mut out = Vec::new();
    let mut group: Vec<Hunk> = Vec::new();
    for change in diff.hunks() {
        if let Some(last) = group.last() {
            if change.before.start - last.before.end > 2 * CONTEXT_LINES {
                out.push(build_hunk(input, &group));
                group.clear();
            }
        }
        group.push(change);
    }
    if !group.is_empty() {
        out.push(build_hunk(input, &group));
    }
    out
}

/// One hunk: the changes in `group`, the unchanged lines between them, and up to
/// `CONTEXT_LINES` of context either end.
fn build_hunk(input: &InternedInput<&str>, group: &[Hunk]) -> DiffHunk {
    let (first, last) = (&group[0], &group[group.len() - 1]);
    let old_start = first.before.start.saturating_sub(CONTEXT_LINES);
    let old_end = (last.before.end + CONTEXT_LINES).min(input.before.len() as u32);
    // The runs between changes are identical on both sides, so the leading context this
    // clamps off is the same length on both -- the two sides stay in step.
    let new_start = first.after.start.saturating_sub(CONTEXT_LINES);
    let new_end = (last.after.end + CONTEXT_LINES).min(input.after.len() as u32);

    let mut lines = Vec::new();
    let (mut old_no, mut new_no) = (old_start, new_start);
    for change in group {
        push_context(
            input,
            &mut lines,
            &mut old_no,
            &mut new_no,
            change.before.start,
        );
        for i in change.before.clone() {
            lines.push(DiffLine {
                kind: LineKind::Del,
                old_no: Some(i + 1),
                // ADR 0010: the worktree has no such line, so there is no new-side
                // number -- which is what withholds the comment affordance.
                new_no: None,
                content: text(input, &input.before, i),
            });
        }
        for i in change.after.clone() {
            lines.push(DiffLine {
                kind: LineKind::Add,
                old_no: None,
                new_no: Some(i + 1),
                content: text(input, &input.after, i),
            });
        }
        old_no = change.before.end;
        new_no = change.after.end;
    }
    push_context(input, &mut lines, &mut old_no, &mut new_no, old_end);

    DiffHunk {
        header: format!(
            "@@ -{} +{} @@",
            range(old_start, old_end - old_start),
            range(new_start, new_end - new_start)
        ),
        lines,
    }
}

/// Unchanged lines up to the old-side index `to`, advancing both sides in step.
fn push_context(
    input: &InternedInput<&str>,
    lines: &mut Vec<DiffLine>,
    old_no: &mut u32,
    new_no: &mut u32,
    to: u32,
) {
    while *old_no < to {
        lines.push(DiffLine {
            kind: LineKind::Context,
            old_no: Some(*old_no + 1),
            new_no: Some(*new_no + 1),
            content: text(input, &input.before, *old_no),
        });
        *old_no += 1;
        *new_no += 1;
    }
}

/// One side of a `@@ -a,b +c,d @@` header, spelled the way git spells it: an empty range
/// names the line it would follow, and a range of exactly one line leaves out the count.
fn range(start: u32, count: u32) -> String {
    let first = if count == 0 { start } else { start + 1 };
    if count == 1 {
        first.to_string()
    } else {
        format!("{first},{count}")
    }
}

/// The text of one line, without the newline that ended it. A file whose last line has
/// no newline is not marked as such: git's `\ No newline at end of file` has no line
/// number, so there is nothing for a Comment to anchor to either way.
fn text(input: &InternedInput<&str>, tokens: &[Token], i: u32) -> String {
    let line = input.interner[tokens[i as usize]];
    let line = line.strip_suffix('\n').unwrap_or(line);
    line.strip_suffix('\r').unwrap_or(line).to_string()
}

#[cfg(test)]
mod tests {
    use super::{count_changes, file_diff};
    use crate::diff::changed_files;
    use crate::diff::fixtures::{commit_a_big_file, spec};
    use crate::test_repo::{git, git_stdout, open, repo_with_a_commit, write, DATE};
    use crate::types::{DiffHunk, DiffMode, DiffSpec, LineKind};

    fn hunks_of(dir: &std::path::Path, spec: &DiffSpec, path: &str) -> Vec<DiffHunk> {
        let git_repo = open(dir);
        let files = changed_files(&git_repo, spec).expect("changed files");
        let file = files
            .iter()
            .find(|file| file.path == path)
            .unwrap_or_else(|| panic!("{path} is not in the diff"));
        file_diff(&git_repo, file).expect("file diff").hunks
    }

    /// Redline's hunks written back out as unified diff text, so they can be held up
    /// against what `git diff` prints.
    fn as_unified(hunks: &[DiffHunk]) -> String {
        let mut out = String::new();
        for hunk in hunks {
            out.push_str(&hunk.header);
            out.push('\n');
            for line in &hunk.lines {
                out.push(match line.kind {
                    LineKind::Context => ' ',
                    LineKind::Add => '+',
                    LineKind::Del => '-',
                });
                out.push_str(&line.content);
                out.push('\n');
            }
        }
        out
    }

    /// `git diff` from the first `@@` on, with the function context git appends to a
    /// hunk header dropped -- Redline's headers are the `@@ -a,b +c,d @@` part alone.
    fn git_diff_hunks(dir: &std::path::Path, args: &[&str]) -> String {
        let mut all = vec!["-c", "diff.algorithm=histogram", "diff"];
        all.extend_from_slice(args);
        let printed = git_stdout(dir, DATE, &all);
        printed
            .lines()
            .skip_while(|line| !line.starts_with("@@"))
            .map(|line| match line.starts_with("@@") {
                true => &line[..line.match_indices("@@").nth(1).expect("closing @@").0 + 2],
                false => line,
            })
            .fold(String::new(), |mut acc, line| {
                acc.push_str(line);
                acc.push('\n');
                acc
            })
    }

    /// A move with edits on top still diffs against the file's own old content, so the
    /// counts are the edit -- not the whole file twice over.
    #[test]
    fn a_move_with_edits_counts_only_the_edits() {
        let dir = tempfile::tempdir().expect("tempdir");
        repo_with_a_commit(dir.path());
        commit_a_big_file(dir.path(), "big.txt");
        git(dir.path(), DATE, &["mv", "big.txt", "moved.txt"]);
        let edited: String = (1..=200)
            .map(|i| {
                if i == 5 {
                    "EDITED\n".to_string()
                } else {
                    format!("line {i}\n")
                }
            })
            .collect();
        write(dir.path(), "moved.txt", &edited);
        git(dir.path(), DATE, &["add", "-A"]);

        let git_repo = open(dir.path());
        let files = changed_files(&git_repo, &spec(DiffMode::Staged, None)).expect("ok");
        let changes = count_changes(&git_repo, &files[0]).expect("count");
        assert_eq!((changes.add, changes.del), (1, 1));
    }

    #[test]
    fn counts_added_and_deleted_lines() {
        let dir = tempfile::tempdir().expect("tempdir");
        repo_with_a_commit(dir.path());
        // one / two / three  ->  one / TWO / three / four
        write(dir.path(), "file.txt", "one\nTWO\nthree\nfour\n");

        let git_repo = open(dir.path());
        let files = changed_files(&git_repo, &spec(DiffMode::Unstaged, None)).expect("ok");
        let changes = count_changes(&git_repo, &files[0]).expect("count");
        assert_eq!((changes.add, changes.del), (2, 1));
    }

    #[test]
    fn a_binary_file_has_no_lines_to_count() {
        let dir = tempfile::tempdir().expect("tempdir");
        repo_with_a_commit(dir.path());
        std::fs::write(dir.path().join("logo.png"), [0x89, b'P', b'N', b'G']).expect("write");

        let git_repo = open(dir.path());
        let files = changed_files(&git_repo, &spec(DiffMode::Unstaged, None)).expect("ok");
        let changes = count_changes(&git_repo, &files[0]).expect("count");
        assert_eq!((changes.add, changes.del), (0, 0));
    }

    /// The whole point of this module: a hunk Redline shows has to name the same lines
    /// `git diff` does, or the `path:L12` handed to a CLI agent points somewhere else.
    #[test]
    fn hunks_match_what_git_diff_prints() {
        let dir = tempfile::tempdir().expect("tempdir");
        repo_with_a_commit(dir.path());
        let before: String = (1..=40).map(|i| format!("line {i}\n")).collect();
        write(dir.path(), "big.txt", &before);
        git(dir.path(), DATE, &["add", "."]);
        git(dir.path(), DATE, &["commit", "-m", "big"]);
        // Two edits far enough apart to stay separate hunks, plus one at the very top
        // where there is no room for three lines of leading context.
        let after: String = (1..=40)
            .map(|i| match i {
                2 => "EDITED 2\n".to_string(),
                20 => "EDITED 20\n".to_string(),
                _ => format!("line {i}\n"),
            })
            .collect();
        write(dir.path(), "big.txt", &after);

        let hunks = hunks_of(dir.path(), &spec(DiffMode::Unstaged, None), "big.txt");
        assert_eq!(
            as_unified(&hunks),
            git_diff_hunks(dir.path(), &["--", "big.txt"])
        );
    }

    /// A CRLF checkout of LF blobs (`core.autocrlf=true`, as on Windows) diffs only the
    /// line that changed, the way `git diff` does -- not every line of the file.
    #[test]
    fn a_crlf_worktree_diffs_like_git_diff() {
        let dir = tempfile::tempdir().expect("tempdir");
        repo_with_a_commit(dir.path());
        git(dir.path(), DATE, &["config", "core.autocrlf", "true"]);
        let before: String = (1..=10).map(|i| format!("line {i}\n")).collect();
        write(dir.path(), "big.txt", &before);
        git(dir.path(), DATE, &["add", "."]);
        git(dir.path(), DATE, &["commit", "-m", "big"]);
        let after: String = (1..=10)
            .map(|i| match i {
                5 => "EDITED 5\r\n".to_string(),
                _ => format!("line {i}\r\n"),
            })
            .collect();
        write(dir.path(), "big.txt", &after);

        let git_repo = open(dir.path());
        let files = changed_files(&git_repo, &spec(DiffMode::Unstaged, None)).expect("ok");
        let changes = count_changes(&git_repo, &files[0]).expect("count");
        assert_eq!((changes.add, changes.del), (1, 1));
        let hunks = hunks_of(dir.path(), &spec(DiffMode::Unstaged, None), "big.txt");
        assert_eq!(
            as_unified(&hunks),
            git_diff_hunks(dir.path(), &["--", "big.txt"])
        );
    }

    /// The same, for Branch mode: its numbers have to be the ones
    /// `git diff $(git merge-base main HEAD)` prints, uncommitted edits included --
    /// which `git diff main...feature` would not show (ADR 0012).
    #[test]
    fn branch_mode_hunks_match_git_diff_against_the_merge_base() {
        let dir = tempfile::tempdir().expect("tempdir");
        repo_with_a_commit(dir.path());
        let before: String = (1..=40).map(|i| format!("line {i}\n")).collect();
        write(dir.path(), "big.txt", &before);
        git(dir.path(), DATE, &["add", "."]);
        git(dir.path(), DATE, &["commit", "-m", "big"]);

        git(dir.path(), DATE, &["checkout", "-b", "feature"]);
        // One edit committed on the branch, a second left in the worktree, far enough
        // apart to stay separate hunks.
        let committed: String = (1..=40)
            .map(|i| match i {
                2 => "EDITED 2\n".to_string(),
                _ => format!("line {i}\n"),
            })
            .collect();
        write(dir.path(), "big.txt", &committed);
        git(dir.path(), DATE, &["add", "."]);
        git(dir.path(), DATE, &["commit", "-m", "edit"]);
        let worktree: String = (1..=40)
            .map(|i| match i {
                2 => "EDITED 2\n".to_string(),
                20 => "EDITED 20\n".to_string(),
                _ => format!("line {i}\n"),
            })
            .collect();
        write(dir.path(), "big.txt", &worktree);

        let mut spec = spec(DiffMode::Branch, Some("main"));
        spec.branch = "feature".into();
        let hunks = hunks_of(dir.path(), &spec, "big.txt");
        let merge_base = git_stdout(dir.path(), DATE, &["merge-base", "main", "feature"]);
        assert_eq!(
            as_unified(&hunks),
            git_diff_hunks(dir.path(), &[merge_base.trim(), "--", "big.txt"])
        );
    }

    #[test]
    fn a_new_file_is_one_hunk_starting_at_line_one() {
        let dir = tempfile::tempdir().expect("tempdir");
        repo_with_a_commit(dir.path());
        write(dir.path(), "new.txt", "alpha\nbeta\n");

        let hunks = hunks_of(dir.path(), &spec(DiffMode::Unstaged, None), "new.txt");
        assert_eq!(hunks[0].header, "@@ -0,0 +1,2 @@");
        assert_eq!(
            hunks[0]
                .lines
                .iter()
                .map(|line| (line.old_no, line.new_no))
                .collect::<Vec<_>>(),
            [(None, Some(1)), (None, Some(2))]
        );
    }

    /// ADR 0010 hangs the add-comment affordance on a del line having no new-side
    /// number: the worktree does not have that line for `path:L12` to resolve against.
    #[test]
    fn a_deleted_line_carries_no_new_side_number() {
        let dir = tempfile::tempdir().expect("tempdir");
        repo_with_a_commit(dir.path());
        write(dir.path(), "file.txt", "one\nthree\n");

        let hunks = hunks_of(dir.path(), &spec(DiffMode::Unstaged, None), "file.txt");
        let del = hunks[0]
            .lines
            .iter()
            .find(|line| matches!(line.kind, LineKind::Del))
            .expect("a del line");
        assert_eq!(
            (del.old_no, del.new_no, del.content.as_str()),
            (Some(2), None, "two")
        );
    }

    /// Context lines are numbered on both sides, and the two numbering spaces drift
    /// apart by exactly what the changes above them added or removed.
    #[test]
    fn context_lines_are_numbered_on_both_sides() {
        let dir = tempfile::tempdir().expect("tempdir");
        repo_with_a_commit(dir.path());
        write(dir.path(), "file.txt", "zero\none\ntwo\nthree\n");

        let hunks = hunks_of(dir.path(), &spec(DiffMode::Unstaged, None), "file.txt");
        let numbers: Vec<_> = hunks[0]
            .lines
            .iter()
            .map(|line| (line.old_no, line.new_no))
            .collect();
        assert_eq!(
            numbers,
            [
                (None, Some(1)),
                (Some(1), Some(2)),
                (Some(2), Some(3)),
                (Some(3), Some(4))
            ]
        );
    }

    /// git merges two changes whose context lines touch into one hunk rather than
    /// printing the same lines twice.
    #[test]
    fn changes_closer_than_twice_the_context_are_one_hunk() {
        let dir = tempfile::tempdir().expect("tempdir");
        repo_with_a_commit(dir.path());
        let before: String = (1..=30).map(|i| format!("line {i}\n")).collect();
        write(dir.path(), "big.txt", &before);
        git(dir.path(), DATE, &["add", "."]);
        git(dir.path(), DATE, &["commit", "-m", "big"]);
        // Six unchanged lines between the two edits: exactly the two context runs.
        let after: String = (1..=30)
            .map(|i| match i {
                10 | 17 => format!("EDITED {i}\n"),
                _ => format!("line {i}\n"),
            })
            .collect();
        write(dir.path(), "big.txt", &after);

        let hunks = hunks_of(dir.path(), &spec(DiffMode::Unstaged, None), "big.txt");
        assert_eq!(
            hunks.len(),
            1,
            "got: {:?}",
            hunks.iter().map(|h| &h.header).collect::<Vec<_>>()
        );
        assert_eq!(hunks[0].header, "@@ -7,14 +7,14 @@");
    }

    /// A single-line range has no count in a git hunk header.
    #[test]
    fn a_one_line_side_leaves_the_count_out_of_the_header() {
        let dir = tempfile::tempdir().expect("tempdir");
        repo_with_a_commit(dir.path());
        write(dir.path(), "one-liner.txt", "only\n");
        git(dir.path(), DATE, &["add", "."]);
        git(dir.path(), DATE, &["commit", "-m", "one-liner"]);
        write(dir.path(), "one-liner.txt", "CHANGED\n");

        let hunks = hunks_of(dir.path(), &spec(DiffMode::Unstaged, None), "one-liner.txt");
        assert_eq!(hunks[0].header, "@@ -1 +1 @@");
    }

    /// A binary file has no lines to diff, and saying so is not the same as saying the
    /// file did not change.
    #[test]
    fn a_binary_file_says_so_rather_than_showing_an_empty_diff() {
        let dir = tempfile::tempdir().expect("tempdir");
        repo_with_a_commit(dir.path());
        std::fs::write(dir.path().join("logo.png"), [0x89, b'P', b'N', b'G']).expect("write");

        let git_repo = open(dir.path());
        let files = changed_files(&git_repo, &spec(DiffMode::Unstaged, None)).expect("ok");
        let diff = file_diff(&git_repo, &files[0]).expect("file diff");
        assert!(diff.binary);
        assert!(diff.hunks.is_empty());
    }

    /// A staged rename with edits on top diffs the file against its own old content,
    /// under the path the reviewer clicked -- the new one.
    #[test]
    fn a_renamed_file_diffs_against_where_it_came_from() {
        let dir = tempfile::tempdir().expect("tempdir");
        repo_with_a_commit(dir.path());
        commit_a_big_file(dir.path(), "big.txt");
        git(dir.path(), DATE, &["mv", "big.txt", "moved.txt"]);
        let edited: String = (1..=200)
            .map(|i| match i {
                5 => "EDITED\n".to_string(),
                _ => format!("line {i}\n"),
            })
            .collect();
        write(dir.path(), "moved.txt", &edited);
        git(dir.path(), DATE, &["add", "-A"]);

        let hunks = hunks_of(dir.path(), &spec(DiffMode::Staged, None), "moved.txt");
        assert_eq!(as_unified(&hunks), "@@ -2,7 +2,7 @@\n line 2\n line 3\n line 4\n-line 5\n+EDITED\n line 6\n line 7\n line 8\n");
    }

    /// The frontend highlights each side whole, so both come back in full -- not just
    /// the lines the hunks show.
    #[test]
    fn a_file_diff_carries_both_sides_in_full() {
        let dir = tempfile::tempdir().expect("tempdir");
        repo_with_a_commit(dir.path());
        write(dir.path(), "file.txt", "one\nTWO\nthree\n");

        let git_repo = open(dir.path());
        let files = changed_files(&git_repo, &spec(DiffMode::Unstaged, None)).expect("ok");
        let diff = file_diff(&git_repo, &files[0]).expect("file diff");
        assert_eq!(diff.old_text, "one\ntwo\nthree\n");
        assert_eq!(diff.new_text, "one\nTWO\nthree\n");
    }
}
