# 10: Docs Agent: wiki updates from commits

**What to build:** After the reviews, a Docs Agent on Claude Code updates the existing org wiki pages whose sources cite files changed by new commits, on a rolling docs branch in its own worktree of the wiki, following the wiki's rules. Saransh finds the branch waiting for review in the Brief. See the PRD's Docs Step.

**Blocked by:** 03: Real Workers: Codex and Claude Code; 04: Tools and skills for Agents

**Status:** done

- [x] The Docs Agent works in its own worktree of the wiki; Saransh's wiki checkout and any edits in it are never touched.
- [x] It works on one rolling docs branch: it continues the branch while unmerged, starts fresh from the main line once it has been merged, and merges the main line in first when it has moved.
- [x] On a merge conflict it stops, leaves the branch as it was, and the Brief says so.
- [x] It updates only existing pages whose sources cite files changed by new commits, reading code only at pinned commits.
- [x] It never documents a Repo for the first time and never uses Discord messages as a source.
- [x] Pages it touches stay as drafts, and the wiki's stamp, region and check tools are run until the check reports no errors.
- [x] It commits under Saransh's git identity with trailers naming the Agent and the Run, and never pushes, or merges the docs branch into the main line (it only merges the main line into the docs branch).
- [x] The Brief lists the docs branch and pages waiting for review, and undocumented Repos with large changes.
- [x] Step tests use a temporary wiki repo to cover continuing, restarting after a merge, merging the main line in, and stopping on conflict.
