# 01: Run skeleton: fetch and list new commits

**What to build:** Saransh runs `agents run daily` and gets a Run folder, named by start date and time, that holds a Brief listing each Repo's new commits on its production branch, grouped by Team, plus the Run's health. The Pipeline, Step contract, Run record, lock and Repo list all exist and work end to end with one real Step (Fetch) and a minimal Brief Step. `agents step <name> --run <id>` reruns one Step inside an existing Run. See the PRD's "Step contract" and "Daily Pipeline Steps" (Fetch, Brief).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `agents run daily` creates a Run whose folder name starts with the local date (year-month-day) followed by hour and minute, and runs Fetch then Brief.
- [ ] `agents step <name> --run <id>` runs one Step inside an existing Run, skips work whose output already exists, and redoes it with `--force`.
- [ ] Each Run keeps a record of the Pipeline, each Step's status, start and end times and log location; the Run ends as succeeded, partial or failed.
- [ ] A second Run refuses to start while one is active.
- [ ] Every Step exits non-zero on failure and reads and writes only the Run folder and state.
- [ ] The Repo list holds the 29 Repos from the PRD with Team, remote, local folder and production branch, including the skill-up, inshortsapp and flutter_payment exceptions.
- [ ] Fetch fetches each Repo's production branch and never pulls, checks out, or changes the working tree or current branch.
- [ ] Fetch never prompts for credentials and times out a hung fetch; a failing Repo is recorded and the others continue, leaving the Run partial.
- [ ] On a Repo's first Run, Fetch records its current head as the starting point instead of listing history.
- [ ] The Brief lists, per Team and Repo, the new commits since the last recorded commit, and a Run health section naming failed or skipped Steps.
- [ ] Run data and state live in a git-ignored data area and are never deleted automatically.
- [ ] Step tests use Node's built-in test runner against temporary git repos with a local remote, and assert only on files, exit codes and git state.
