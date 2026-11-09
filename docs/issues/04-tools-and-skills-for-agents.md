# 04: Tools and skills for Agents

**What to build:** An Agent can declare Tools and skills, and its Worker gets exactly those, without anything being written into the Repo or wiki folder the Agent works in. See the PRD's "Agents" (Tools and skills).

**Blocked by:** 03: Real Workers: Codex and Claude Code

**Status:** done

- [x] An Agent's Tools are small commands it owns; the Step allows exactly those plus the Worker's built-in read and search tools, and lists them with their usage in the prompt.
- [x] A Tool the Agent didn't declare cannot be run during its call.
- [x] Claude Code receives an Agent's skills as a session-only plugin.
- [x] Codex receives an Agent's skills as text in its prompt.
- [x] After a call, the target Repo or wiki folder has no new or changed files from Tool or skill delivery.
- [x] Command-line tests cover Tool allowlists and skill delivery for both Workers.

**Notes:**

- **Checked on 4 November 2026** against the code and its tests, after this issue's status had gone stale: `test/workers.test.ts` covers the Tool allowlists and skill delivery, `test/review.test.ts` that no file reaches the Repo and that Codex can't run an undeclared Tool, and `test/agent.test.ts` that an Agent's Tools must be its own.
