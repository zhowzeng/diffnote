//! Git fixtures for tests.
//!
//! Branch and diff behaviour needs real commits, so these drive the `git` CLI rather
//! than hand-writing objects. Global and system config are cut off so a contributor's
//! own git settings can't change what a fixture produces.

pub fn git(dir: &std::path::Path, date: &str, args: &[&str]) {
    git_stdout(dir, date, args);
}

/// What the git CLI printed -- for the tests that hold Diffnote's own diff up against it.
pub fn git_stdout(dir: &std::path::Path, date: &str, args: &[&str]) -> String {
    let out = std::process::Command::new("git")
        .args(args)
        .current_dir(dir)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_SYSTEM", "/dev/null")
        .env("GIT_AUTHOR_NAME", "Diffnote Test")
        .env("GIT_AUTHOR_EMAIL", "test@diffnote.invalid")
        .env("GIT_AUTHOR_DATE", date)
        .env("GIT_COMMITTER_NAME", "Diffnote Test")
        .env("GIT_COMMITTER_EMAIL", "test@diffnote.invalid")
        .env("GIT_COMMITTER_DATE", date)
        .output()
        .expect("run git");
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8(out.stdout).expect("git printed utf-8")
}

pub const DATE: &str = "2020-01-01T00:00:00Z";

/// A repo on `main` holding one committed file.
pub fn repo_with_a_commit(dir: &std::path::Path) {
    git(dir, DATE, &["init", "-b", "main", "."]);
    write(dir, "file.txt", "one\ntwo\nthree\n");
    git(dir, DATE, &["add", "."]);
    git(dir, DATE, &["commit", "-m", "first"]);
}

pub fn write(dir: &std::path::Path, path: &str, contents: &str) {
    let file = dir.join(path);
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).expect("create parent");
    }
    std::fs::write(file, contents).expect("write");
}

pub fn open(dir: &std::path::Path) -> gix::Repository {
    gix::open(dir).expect("open")
}
