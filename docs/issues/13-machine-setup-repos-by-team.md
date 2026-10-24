# 13: Machine setup: Repos by Team

**What to build:** On a fresh Mac or Windows machine, Saransh runs `agents setup` (optionally `--team flutter,backend`) and gets every selected Repo cloned into a folder named for its Team on its production branch, a check of the tools the Pipeline needs, and a checklist of what setup can't do. See the PRD's "Setup".

**Blocked by:** 01: Run skeleton: fetch and list new commits

**Status:** done

- [x] `agents setup` creates the Team folders and clones each Repo from the Repo list onto its production branch.
- [x] `--team` limits setup to the named Teams.
- [x] A Repo whose folder already exists is left as it is and reported.
- [x] Setup checks that git, Node and the three Worker CLIs are installed and flags Workers older than the versions the PRD notes.
- [x] Setup prints a checklist of manual steps: SDKs and IDEs, secrets and env files, and folders that aren't Repos.
- [x] Setup uses no bash and runs on both macOS and Windows.
- [x] Tests run setup against local "remote" repos in a temporary folder and check folders, branches and the untouched existing folder.

**Notes:**

- `agents setup [--team <team,...>] [--root <folder>]` clones each Repo into `<root>/<team>/<name>` with `git clone --branch <production branch>`. The root defaults to the folder holding the agents repo, which is where the Team folders sit on this Mac. `--team` takes a comma-separated list, can be repeated, and an unknown Team is refused before anything is made. It goes by each Repo's Team, so the data Repos land in `data/`, not under `backend/` as on this Mac.
- Any existing path at a Repo's folder is left as it is and reported, with a note when it isn't a git clone. Git gets the terminal, so it can ask for credentials and shows its progress and errors. A failed clone is reported and the others go on.
- It checks git, node, claude, codex and agy first, by finding each on PATH (on Windows by PATHEXT, so npm's `.cmd` shims run through `cmd.exe /s /c`) and running `--version`. Node is flagged below package.json's `engines` (25), codex below 0.163.0 and agy below 1.4.5, the versions the PRD notes. Without git it clones nothing.
- It exits 1 when a command is missing or a clone failed. Outdated commands only warn.
- The checklist lists SDKs and IDEs for the selected Repos' Teams, GitHub access (naming the Repos with SSH remotes), the agents repo's `.env` and each Repo's own env files, the folders that aren't Repos, and the Worker logins, including the one into the Pipeline's own Antigravity home.
- The tests run `agents setup` against local remotes in a temporary folder, with stand-in commands on PATH (`.cmd` files on Windows), and pass on Windows. They build their own machine instead of using the workspace in `test/helpers.ts`, which can't run on Windows until issue 16.
