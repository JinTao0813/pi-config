---
name: submit-pr
description: Push the current reviewed branch and create or update its pull request.
disable-model-invocation: true
---

# Submit PR

Publish the exact revision completed by `/implement` and checked by `/code-review`. Invocation authorises the branch push and PR creation. Stop at an open PR; merging is a separate decision.

An argument may name the base branch, implementation issue, spec, or request a draft.

## Process

### 1. Pin the submission

Inspect the repository and establish:

- the current branch and `HEAD` SHA,
- the push remote, preferring the branch upstream, then `origin`, then the only configured remote,
- the hosting provider from that remote,
- the base branch, preferring the argument, then an existing PR's base, then the remote's default branch.

Fetch the push remote. Resolve the base and compare it with `git diff <remote>/<base>...HEAD` and `git log <remote>/<base>..HEAD --oneline`.

Stop with the exact failed condition when the repository has a detached `HEAD`, an in-progress merge or rebase, a dirty worktree, the current branch is the base branch, the base does not resolve, or the diff is empty. Ask only when the remote or base is genuinely ambiguous.

**Complete when:** one named remote, base, branch, and non-empty revision range are pinned.

### 2. Prove readiness

Use the `/code-review` report already in context when it covers the pinned range and no changes followed it. Otherwise run `/code-review` against the pinned remote base. Present any findings that have not been dispositioned and ask whether to fix them or submit as-is.

Collect verification commands and results already established for this exact tree. If none are available, run the repository's documented validation commands. Read them from the environment, such as project docs, task files, and package scripts. Record only commands actually run and their outcomes.

If readiness work changes tracked files, return to `/implement`; repeat this process after the resulting commit.

**Complete when:** the clean, committed `HEAD` has a current review disposition and accurate verification evidence.

### 3. Build PR metadata

Find the immediate implementation ticket or spec in this order:

1. an argument or source already established in context,
2. issue references in the branch commits,
3. an unambiguous issue reference in the branch name.

Read `docs/agents/issue-tracker.md` when present and fetch the source through its documented workflow. An immediate implementation ticket gets closing syntax. A parent issue is linked as context, not closed. For a local source, link its repository path. Proceed without a source when none can be established without guessing.

Write a concise title from the source title or, without one, the branch's delivered behaviour. Draft the body from the source and diff. In `## Summary`, describe the delivered outcome and its purpose in one or two sentences. In `## Changes`, group implementation details under descriptive categories. Include only categories supported by the diff.

```markdown
## Summary

<delivered outcome and purpose>

## Changes

### <category>

- <specific change>

### <category>

- <specific change>

## Verification

- `<command>`: passed

## Source

Closes #<implementation-ticket>
```

Include `## Source` only when a source exists. Report failed or unavailable verification plainly. Use a temporary body file outside the worktree and remove it after publication.

**Complete when:** every title and body claim is supported by the source, diff, or recorded command output.

### 4. Publish idempotently

Use the provider CLI already named by the remote and consult its `--help` for current flags:

- GitHub: `gh pr`
- GitLab: `glab mr`
- another host: the repository's documented PR workflow

Check authentication before writing. If authentication needs human action, use `/wizard`, then resume here.

Look for a PR whose head is the current remote and branch. An open PR makes this an update: preserve its existing metadata and push the new revision. A closed or merged PR for the same branch is ambiguous; stop and show it rather than creating a duplicate.

Use an ordinary upstream-setting push. If the remote rejects it, stop with the rejection instead of rewriting remote history. Recheck for an existing PR after the push, then create one only when none exists. Set the pinned base and head explicitly. Create a ready-for-review PR unless the user requested a draft.

**Complete when:** exactly one open PR exists for the pinned head branch.

### 5. Verify publication

Read the PR back from the provider. Confirm:

- its URL and open state,
- its base and head branches,
- its remote head SHA equals the pinned local `HEAD`,
- its title and body are the intended values when newly created.

Return the PR URL, base/head, source link if any, and verification commands. A URL alone is not completion; the remote PR must contain the pinned SHA.
