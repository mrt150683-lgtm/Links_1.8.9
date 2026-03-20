\# Git Safety Protocol (Zero-Drama Git)



This document defines the only allowed workflow for commits, merges, pushes, and releases in this repo.


https://github.com/mrt150683-lgtm/Links
---



\## 1) Core rule

\*\*The assistant must explain the plan BEFORE running git commands.\*\*



Required “pre-flight” outputs before any git action:

\- `git status`

\- `git branch --show-current`

\- `git log --oneline -n 10`



If any of these outputs indicate risk (detached HEAD, dirty tree with unknown files, wrong branch), stop and propose fix.



---



\## 2) Branching model (simple + safe)

\- `main` = stable

\- `dev` = integration (optional, but recommended if you deploy often)

\- `feature/<area>-<desc>` = work branches

\- `hotfix/<desc>` = urgent fixes off main



Rules:

\- Never work directly on `main`.

\- Features merge into `dev` first (if `dev` exists), then to `main`.



---



\## 3) Commit rules

\### 3.1 Commit size

\- One logical change set per commit.

\- If it feels big, split it.



\### 3.2 Message format

Use conventional commits:

\- `feat(<area>): ...`

\- `fix(<area>): ...`

\- `chore: ...`

\- `docs: ...`

\- `test(<area>): ...`

\- `refactor(<area>): ...`



Examples:

\- `feat(storage): add encrypted asset store`

\- `fix(api): validate pot\_id on entry creation`

\- `docs: add pipeline job lifecycle`



\### 3.3 Required checks before commit

Run:

\- `pnpm test`

\- `pnpm lint` (or equivalent)



If skipping (rare), it must be explicitly stated with reason.



---



\## 4) Push rules (no accidental chaos)

Before pushing:

\- Show `git remote -v`

\- Confirm upstream tracking:

&nbsp; - `git rev-parse --abbrev-ref --symbolic-full-name @{u}` (if configured)

\- Confirm what will be pushed:

&nbsp; - `git log --oneline --decorate -n 10`

&nbsp; - `git diff --stat <upstream>..HEAD` (if upstream exists)



Then push:

\- `git push -u origin <branch>` (first push)

\- `git push` (afterwards)



Never push from the wrong branch.



---



\## 5) Merge rules (boring is good)

Preferred merge:

\- `git merge --no-ff <branch>`



Never squash unless requested.



Conflict handling:

\- Stop.

\- Explain conflict files and why.

\- Propose resolution plan.

\- Only then resolve.



---



\## 6) Forbidden (unless Alex explicitly approves)

\- `git push --force` or `--force-with-lease`

\- Rebase on shared branches

\- Deleting remote branches

\- Rewriting main history



---



\## 7) Recovery playbook (safe undo)

\### 7.1 Unstage a file

\- `git restore --staged <file>`



\### 7.2 Discard local changes to a file (danger)

\- `git restore <file>`



\### 7.3 Undo last commit but keep changes (not pushed)

\- `git reset --soft HEAD~1`



\### 7.4 Abort a merge

\- `git merge --abort`



\### 7.5 Stash

\- `git stash push -m "wip: <desc>"`

\- `git stash list`

\- `git stash pop`



---



\## 8) Release tagging (optional)

\- `git tag -a vX.Y.Z -m "release: vX.Y.Z"`

\- `git push origin vX.Y.Z`



Only tag from `main`.



---



