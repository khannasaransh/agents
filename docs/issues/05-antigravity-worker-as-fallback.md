# 05: Antigravity Worker as fallback

**What to build:** An Agent can name Antigravity as its fallback Worker, and a call that falls back to it returns a schema-checked result like the other Workers. Antigravity is not allowed as an Agent's main Worker until its headless bugs are fixed. See the PRD's "Workers" and Further Notes.

**Blocked by:** 03: Real Workers: Codex and Claude Code

**Status:** ready-for-agent

- [ ] An Antigravity Worker runs an Agent through print mode with JSON output and its schema option.
- [ ] Its timeout is enforced by ending the process, since its print mode can report success while a command it started is still running.
- [ ] Skills reach it as prompt text; its permissions are mapped to its sandbox and allowlist, noting that print mode currently ignores the allowlist.
- [ ] Config validation rejects Antigravity as an Agent's main Worker and accepts it as a fallback.
- [ ] Command-line tests cover the Antigravity Worker.
