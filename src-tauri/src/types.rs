use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Repo {
    pub id: String,
    pub name: String,
    pub path: String,
    /// Base branch a Branch-mode diff is compared against by default.
    pub default_branch: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    pub name: String,
    pub is_current: bool,
    /// Commits this branch has that its upstream does not, or `None` when there is no
    /// upstream to count against -- which is not the same as being in sync.
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
}

/// What `list_branches` hands back: the branches, plus what HEAD is doing when it is
/// not on any of them. ADR 0010 makes the topbar a read-only indicator of what is
/// checked out, so it has to be able to say "no branch" rather than name one.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchList {
    pub branches: Vec<Branch>,
    /// Short commit id when HEAD is detached, `None` when it is on a branch.
    pub detached_head: Option<String>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DiffMode {
    Unstaged,
    Staged,
    Branch,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffSpec {
    pub repo_id: String,
    pub branch: String,
    pub diff_mode: DiffMode,
    pub base_branch: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Changes {
    pub add: u32,
    pub del: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TreeNode {
    #[serde(rename_all = "camelCase")]
    Dir {
        name: String,
        path: String,
        children: Vec<TreeNode>,
    },
    #[serde(rename_all = "camelCase")]
    File {
        name: String,
        path: String,
        changes: Option<Changes>,
        /// Where this file used to be, when it was renamed into `path`. The old path is
        /// not a node of its own -- the file moved, it wasn't deleted and recreated.
        renamed_from: Option<String>,
    },
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LineKind {
    Context,
    Add,
    Del,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    pub kind: LineKind,
    pub old_no: Option<u32>,
    pub new_no: Option<u32>,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
    pub header: String,
    pub lines: Vec<DiffLine>,
}

/// One file's line-level diff between the two sides of a Diff Mode.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub hunks: Vec<DiffHunk>,
    /// A file neither side can decode as UTF-8, so there are no lines to diff and the
    /// diff view says so rather than showing an empty diff for a file that did change.
    pub binary: bool,
    /// Both sides in full, which the frontend highlights whole: a hunk that starts
    /// inside a block comment or string can't be highlighted from its own lines alone.
    /// Empty when `binary`.
    pub old_text: String,
    pub new_text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    pub lines: Vec<String>,
    /// A file Diffnote cannot number by line, so File View shows it as such instead of
    /// rendering lossy text no Comment could anchor to.
    pub binary: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchResult {
    pub success: bool,
    pub message: String,
}
