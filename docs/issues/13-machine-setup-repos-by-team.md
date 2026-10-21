# 13: Machine setup: Repos by Team

**What to build:** On a fresh Mac or Windows machine, Saransh runs `agents setup` (optionally `--team flutter,backend`) and gets every selected Repo cloned into a folder named for its Team on its production branch, a check of the tools the Pipeline needs, and a checklist of what setup can't do. See the PRD's "Setup".

**Blocked by:** 01: Run skeleton: fetch and list new commits

**Status:** ready-for-agent

- [ ] `agents setup` creates the Team folders and clones each Repo from the Repo list onto its production branch.
- [ ] `--team` limits setup to the named Teams.
- [ ] A Repo whose folder already exists is left as it is and reported.
- [ ] Setup checks that git, Node and the three Worker CLIs are installed and flags Workers older than the versions the PRD notes.
- [ ] Setup prints a checklist of manual steps: SDKs and IDEs, secrets and env files, and folders that aren't Repos.
- [ ] Setup uses no bash and runs on both macOS and Windows.
- [ ] Tests run setup against local "remote" repos in a temporary folder and check folders, branches and the untouched existing folder.
