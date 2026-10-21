# 14: Machine setup: Worker config

**What to build:** The Claude Code, Codex and Antigravity config Saransh uses (settings, status line, plugins and marketplaces, MCP servers) is kept in the agents repo, and `agents setup` installs it on any machine with machine-specific paths adjusted, so every Worker behaves the same everywhere. See the PRD's "Setup".

**Blocked by:** 13: Machine setup: Repos by Team

**Status:** ready-for-agent

- [ ] The agents repo holds the Workers' config, captured from this Mac, with no secrets or tokens in it.
- [ ] `agents setup` installs that config into each Worker's config location on macOS and Windows.
- [ ] Paths that point at this Mac are rewritten for the target machine.
- [ ] Existing config on the target machine is backed up before it is replaced, and setup reports what changed.
- [ ] Secrets the config needs are listed in the manual checklist instead of copied.
- [ ] Tests install the config into a temporary home folder for each OS layout and check the rewritten paths and backups.
