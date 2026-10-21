# 04: Tools and skills for Agents

**What to build:** An Agent can declare Tools and skills, and its Worker gets exactly those, without anything being written into the Repo or wiki folder the Agent works in. See the PRD's "Agents" (Tools and skills).

**Blocked by:** 03: Real Workers: Codex and Claude Code

**Status:** ready-for-agent

- [ ] An Agent's Tools are small commands it owns; the Step allows exactly those plus the Worker's built-in read and search tools, and lists them with their usage in the prompt.
- [ ] A Tool the Agent didn't declare cannot be run during its call.
- [ ] Claude Code receives an Agent's skills as a session-only plugin.
- [ ] Codex receives an Agent's skills as text in its prompt.
- [ ] After a call, the target Repo or wiki folder has no new or changed files from Tool or skill delivery.
- [ ] Command-line tests cover Tool allowlists and skill delivery for both Workers.
