# 14: Machine setup: Worker config

**What to build:** The Claude Code, Codex and Antigravity config Saransh uses (settings, status line, plugins and marketplaces, MCP servers) is kept in the agents repo, and `agents setup` installs it on any machine with machine-specific paths adjusted, so every Worker behaves the same everywhere. See the PRD's "Setup".

**Blocked by:** 13: Machine setup: Repos by Team

**Status:** done

- [x] The agents repo holds the Workers' config, captured from this Mac, with no secrets or tokens in it.
- [x] `agents setup` installs that config into each Worker's config location on macOS and Windows.
- [x] Paths that point at this Mac are rewritten for the target machine.
- [x] Existing config on the target machine is backed up before it is replaced, and setup reports what changed.
- [x] Secrets the config needs are listed in the manual checklist instead of copied.
- [x] Tests install the config into a temporary home folder for each OS layout and check the rewritten paths and backups.

**Notes:**

- The config in `worker-config/` was captured from Saransh's Windows PC, not the Mac, since that is where this was built. Running `agents setup capture` on the Mac and committing the result replaces it with the Mac's.
- `worker-config/` holds a folder per Worker (`claude-code`, `codex`, `antigravity`), laid out as in the home folder. Each Worker keeps its config in the same place under the home folder on macOS and Windows: `~/.claude` and `~/.claude.json`, `~/.codex`, and `~/.gemini`. Setup ignores `CLAUDE_CONFIG_DIR` and `CODEX_HOME`.
- `agents setup capture [--root <folder>]` copies this machine's config into the repo, replacing what was there:
  - Claude Code: `settings.json`, with the plugin marketplaces it knows added as `extraKnownMarketplaces` so another machine installs the plugins it enables; `statusline.sh`; and the MCP servers from `~/.claude.json`, without the login and history Claude Code keeps there.
  - Codex: `config.toml`, without the entries the Codex app writes on every start, which point at its own runtime (`notify`, the `node_repl` MCP server, and the `openai-bundled` and `openai-primary-runtime` marketplaces); and `AGENTS.md`.
  - Antigravity: `antigravity-cli/settings.json`, `antigravity-cli/keybindings.json` and `config/mcp_config.json`.
  - It skips files that are missing or empty, and reads everything before changing the repo.
- Paths inside the home folder or the root (the folder holding the Team folders) are captured as `{{home}}` and `{{root}}`, whatever their separators, escaping or letter case. Setup turns them into the target machine's paths:
  - In JSON and shell scripts, Windows paths get forward slashes, since Claude Code runs its status line and hooks through bash there.
  - In TOML they keep Windows' backslashes, escaped in basic strings, since Codex keys the folders it trusts by them.
  - Paths elsewhere, such as `/opt/homebrew/...` in an MCP server's command, are installed as they are. So is OS-only config, such as Codex's `[windows]` table, which another OS ignores.
- A setting whose name ends in token, secret, password, API key, authorization, cookie or credentials is left out of the capture. In a TOML inline table its value is emptied instead. Each one goes in `worker-config/secrets.json`, and setup's checklist names it to set by hand. Capture refuses a file still holding something shaped like an API key or token, such as one inside a shell script or an argument list, and leaves the repo as it was.
- Setup replaces each file whole, apart from `.claude.json`. Running it again therefore resets secrets set by hand since the last run, though the backup keeps them. On Windows it also reports `config.toml` replaced, since the Codex app adds its own entries back each time it starts.
- Setup copies a file it would change beside itself, as `<name>.backup-<time>`, and reports each file as installed, already as in this repo, or replaced with the backup's path. JSON that differs only in spacing counts as unchanged. In `~/.claude.json` setup replaces only the top-level keys the config holds. It makes shell scripts executable. `.gitattributes` keeps `worker-config/` in LF line endings, so a Windows checkout doesn't break the status line script.
- The setup tests capture from one temporary home and install into another. Pure checks in `test/worker-config.test.ts` cover the rewriting for the OS the tests aren't running on.
