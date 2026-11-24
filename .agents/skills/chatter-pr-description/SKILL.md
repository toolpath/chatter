---
name: chatter-pr-description
description: Writes or updates the pull request description of a Chatter branch - the line-count table of `npm run loc` at the top, then the summary, what changed and why, tests, docs, risks and follow-ups, and the stack and base note. Use when the user says "write the PR description", "/chatter-pr-description", "open a PR", or after a fix adds commits to an open PR ("update the PR body").
---

# Write the pull request description

Write a description that a reviewer can trust. Each sentence comes from evidence: the commits, the diff, the plan, or a check that someone ran.

## Inputs

- **No argument:** the current branch and its open pull request.
- **`--base <branch>`:** a different base branch, for example the branch below this one in a stack.
- **`--plan <file>[#item]`:** the plan item that this change does. Read it for the "why" and for the follow-ups.
- **`--pr <n>`:** the pull request to update.
- **`update`:** update the body of an open pull request. Then do [Update mode](#update-mode).

Run each command of a step as a separate command. Some sandboxes refuse a long command with `&&`, `;` or `$(...)`. Copy the output of one command into the next by hand.

## Base and head: two names for each

"Base" has two meanings. Do not mix them.

| Name | What it is | Where you use it |
| --- | --- | --- |
| Base branch | The branch name of the pull request, for example `main` or `feat/x`. It is `baseRefName` in `gh pr view`. | Only `gh pr create --base <base branch>` and the Stack section |
| Base ref | The git ref of the remote branch: `origin/<base branch>`, for example `origin/main` | Each git command and `npm run loc -- --base <base ref>` |

Do not use the bare base branch in a git command. A local `main` can be old, and a worktree or a new clone can have no local `main`. Then the merge base is wrong, or `npm run loc` exits with "Cannot find the base".

The head is the same:

- If the branch of the pull request is checked out, the head ref is `HEAD`.
- Else, the head ref is `origin/<head branch>` (`headRefName` in `gh pr view`). Give it to `npm run loc` with `--head origin/<head branch>`. Use it in place of `HEAD` in each git command below.

To find the names:

1. `git fetch origin`
2. `gh pr view --json number,baseRefName,headRefName,headRefOid,body` (add the number if the branch is not checked out). If there is no pull request, the base branch is `main`.
3. `git branch --show-current`. If it is not the head branch, use `origin/<head branch>` as the head ref.

## 1. Collect the evidence

Run each command by itself:

1. `git merge-base <base ref> <head ref>`. Call the result `M`.
2. The commits: `git log --format=%s%n%b M..<head ref>`.
3. The files: `git diff --stat M <head ref>`.
4. The diff: `git diff M <head ref>`. Read each new file.
5. The size: `npm run -s loc -- --base <base ref> --head <head ref>`. Copy its output as it is. Do not change a number.
6. The plan item, if there is a `--plan`.
7. The logs in `.quality/`, if they are there. They tell which checks ran and what they found.

**Do not run the tests again.** List only the checks that have evidence: a log, a CI run, or a result in this conversation. Say who ran each check (you, the CI, or the user). If a check has no evidence, do not say that it passed.

## 2. Write the body

Use ASD-STE100 Simplified Technical English: short sentences, active voice, one idea in each sentence. Use this template:

```markdown
## Size

<!-- loc:start base=<merge base sha> head=<head sha> -->
<output of npm run -s loc -- --base <base ref> --head <head ref>>
<!-- loc:end -->

## Summary

<One to three sentences: what the change does for the user, and why.>

## Stack

Base: `<base branch>`. <"Targets main." or "Merge after #N.">

## What changed and why

**Server**
- <A change and its reason, in one line.>

**Web** / **Shared** / **Tools** / **CI** / **Docs**
- <Only the areas that the change touches.>

## Tests

- <A test file: the behavior that it proves.>
- Checks: <each check with evidence, and who ran it. For example: "npm test passed (ran locally)", "CI: green".>
- <"Tested on a real <machine>." or "Not tested on a real machine.">

## Docs

- <Each changed page and what it now tells. Or: "No docs change.", with the reason.>

## Risks and follow-ups

- <A risk, a data migration, or an AGENTS.md guardrail that the change touches (kept or changed).>
- <A follow-up, with its plan item.>
```

The rules:

- Put `## Size` at the very top of the body, before `## Summary` and before all other text. Keep `## Size` always.
- Leave out each other section only when it has nothing true to say.
- Group the bullets in "What changed and why" by area. One line for each change. One line for each fix.
- In "Risks and follow-ups", check the guardrails in `AGENTS.md`. Name each one that the diff touches.
- Use the full shas of `git merge-base <base ref> <head ref>` and `git rev-parse <head ref>` in the `loc:start` marker.
- **Do not add a "Generated with" line. Do not add a `Co-Authored-By` line.** CONTRIBUTING.md forbids AI attribution in a pull request.

## 3. Give the body

1. Write the body to a scratch file. Never pass the body on the command line.
2. If the user asked you to open or edit the pull request:
   - New: `gh pr create --base <base branch> --title "<prefix>: <subject>" --body-file <file>`. Use a title with a commit prefix, such as `feat(web):` or `fix(server):`.
   - Open: `gh pr edit <n> --body-file <file>`.
3. Else print the body, and tell the user the path of the file.

## Update mode

Use it after a review fix adds commits to an open pull request. Run each command by itself.

1. `git fetch origin`
2. `gh pr view <n> --json body,baseRefName,headRefName,headRefOid`. Find the base ref and the head ref as in [Base and head](#base-and-head-two-names-for-each).
3. Find the old head: the head that the body tells about.
   - If the body has the marker `<!-- loc:start base=... head=<old head> -->`, use that sha.
   - Else, find the last commit before the review. Run `gh api repos/{owner}/{repo}/pulls/<n>/reviews --jq '.[] | [.submitted_at, .commit_id, .user.login] | @tsv'`. The `commit_id` of the first review is the head that the reviewer read.
   - If there is no review, run `gh pr view <n> --json commits --jq '.commits[] | [.committedDate, .oid, .messageHeadline] | @tsv'`. Find the last commit before the date of the review comment or the old body.
   - If you cannot find it, ask the user.
4. `git merge-base --is-ancestor <old head> <head ref>`. Exit code 0: the old head is in the branch. Else, a force-push rebased the branch.
5. List the new commits:
   - The old head is in the branch: `git log --format=%s <old head>..<head ref>`.
   - After a rebase: `git log --format=%s M..<head ref>` (M from [step 1 of Collect](#1-collect-the-evidence)). Keep only the subjects that the old body does not tell about. If you cannot tell, ask the user.
6. `npm run -s loc -- --base <base ref> --head <head ref>`. Replace only the text between `<!-- loc:start ... -->` and `<!-- loc:end -->`. Put the full shas of the new merge base and the new head in the marker. Keep `## Size` at the very top of the body. If it is in a different position, move it to the top.
7. Add a section `## Changes after review`, or add to it. Write one line for each new commit subject. If the body already has a detailed section about the fixes (for example "Review fixes" or "Fixes per finding"), keep that detail below the list, and add to it in the same layout.
8. Keep the sections that a person wrote. Change a sentence only when a new commit makes it wrong. Then say in "Changes after review" which sentence you changed.
9. If the base changed (the branch below merged, or the pull request has a new base), write the Stack section again.
10. Write the body to a scratch file, then run `gh pr edit <n> --body-file <file>`.

### An older body with a different layout

An older body can have other section names. Do not rewrite it to the template. Change only these items:

- "Line count", "Lines", "Diff size" or a similar table: replace it with `## Size` and the markers. Write the new table of `npm run loc` in it. Move `## Size` to the very top of the body.
- "Fixes per finding", "Review fixes" and other sections with one part for each finding: keep the layout. Add new fixes in the same layout. Do not change them to bullets for each area.
- A section that the template has and the body does not have (for example `## Size` or `## Stack`): add it. Add `## Size` at the very top of the body.

### Checks that an older body tells about

The body can say that a check passed, with no log and no CI run that you can find.

- Keep the claim only if you can name who ran the check. Write it as "<check> passed (reported by <who>; no log)".
- If you cannot name who ran it, remove the claim, and say in "Changes after review" that you removed it.
- A check that you ran in this conversation, or a CI run of the new head, replaces the old claim.
