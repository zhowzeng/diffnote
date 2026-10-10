//! The reviewer's Repo list: adding a folder, dropping one, and reading back what a
//! git repository says about itself when it is added.

use crate::store;
use crate::types::Repo;

#[tauri::command]
pub fn list_repos(app: tauri::AppHandle) -> Result<Vec<Repo>, String> {
    store::load_repos(&app)
}

/// Registers the git repository at `path` as a Repo, keyed by its canonical path so
/// adding the same folder twice doesn't duplicate it.
#[tauri::command]
pub fn add_repo(app: tauri::AppHandle, path: String) -> Result<Repo, String> {
    let repo = read_repo(&path)?;
    let mut repos = store::load_repos(&app)?;
    if let Some(existing) = repos.iter().find(|r| r.id == repo.id) {
        return Ok(existing.clone());
    }
    repos.push(repo.clone());
    store::save_repos(&app, &repos)?;
    Ok(repo)
}

/// Drops the Repo from the reviewer's list. This only edits Diffnote's own list — the
/// folder on disk is left alone.
#[tauri::command]
pub fn remove_repo(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let mut repos = store::load_repos(&app)?;
    repos.retain(|r| r.id != id);
    store::save_repos(&app, &repos)
}

fn read_repo(path: &str) -> Result<Repo, String> {
    let git = gix::open(path).map_err(|e| format!("Not a git repository: {path} ({e})"))?;
    let canonical = std::fs::canonicalize(path)
        .map_err(|e| format!("Cannot resolve {path}: {e}"))?
        .to_string_lossy()
        .into_owned();
    let name = std::path::Path::new(&canonical)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| canonical.clone());
    Ok(Repo {
        id: canonical.clone(),
        name,
        path: canonical,
        default_branch: default_branch(&git),
    })
}

/// The Repo's default branch: what `origin/HEAD` points at, falling back to whatever
/// branch is checked out for a repository with no remote.
fn default_branch(git: &gix::Repository) -> String {
    if let Ok(head) = git.find_reference("refs/remotes/origin/HEAD") {
        if let gix::refs::TargetRef::Symbolic(name) = head.target() {
            let short = name.shorten().to_string();
            if let Some(branch) = short.strip_prefix("origin/") {
                return branch.to_string();
            }
        }
    }
    git.head_name()
        .ok()
        .flatten()
        .map(|name| name.shorten().to_string())
        .unwrap_or_else(|| "main".to_string())
}

#[cfg(test)]
mod tests {
    use super::read_repo;

    /// Lays out a git repository whose HEAD is on `head_branch`, optionally with an
    /// `origin/HEAD` symref — the two things `default_branch` reads.
    fn make_repo(dir: &std::path::Path, head_branch: &str, origin_head: Option<&str>) {
        gix::init(dir).expect("init");
        let git_dir = dir.join(".git");
        std::fs::write(
            git_dir.join("HEAD"),
            format!("ref: refs/heads/{head_branch}\n"),
        )
        .expect("write HEAD");
        if let Some(branch) = origin_head {
            let remote = git_dir.join("refs/remotes/origin");
            std::fs::create_dir_all(&remote).expect("create origin refs");
            std::fs::write(
                remote.join("HEAD"),
                format!("ref: refs/remotes/origin/{branch}\n"),
            )
            .expect("write origin/HEAD");
        }
    }

    #[test]
    fn rejects_a_directory_that_is_not_a_git_repo() {
        let dir = tempfile::tempdir().expect("tempdir");
        let err = read_repo(&dir.path().to_string_lossy()).expect_err("should reject");
        assert!(err.starts_with("Not a git repository:"), "got: {err}");
    }

    #[test]
    fn default_branch_comes_from_origin_head() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path().join("my-repo");
        std::fs::create_dir(&root).expect("create repo dir");
        make_repo(&root, "feature/xlsx-api-upgrade", Some("main"));

        let repo = read_repo(&root.to_string_lossy()).expect("should read");
        assert_eq!(repo.name, "my-repo");
        assert_eq!(repo.default_branch, "main");
        // A Repo is identified by its canonical path, so the same folder added twice
        // keeps one id.
        assert_eq!(repo.id, repo.path);
        assert_eq!(
            repo.path,
            std::fs::canonicalize(&root).unwrap().to_string_lossy()
        );
    }

    #[test]
    fn falls_back_to_the_checked_out_branch_without_a_remote() {
        let dir = tempfile::tempdir().expect("tempdir");
        make_repo(dir.path(), "develop", None);

        let repo = read_repo(&dir.path().to_string_lossy()).expect("should read");
        assert_eq!(repo.default_branch, "develop");
    }
}
