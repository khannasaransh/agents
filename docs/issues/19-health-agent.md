# 19: Health Agent

**What to build:** When the Lake Step fails or the Health report flags something, a read-only Health Agent works out why and proposes a fix. The Stocks Brief shows its diagnosis, so Saransh starts from a diagnosis rather than a log. See the stocks Pipeline PRD's Health Step and "Agents".

**Repos:** agents

**Blocked by:** 17: Stocks Pipeline skeleton: the Lake Step and a data-status Stocks Brief

**Status:** ready-for-agent

- [ ] A Health Agent runs on Codex, with Claude Code as fallback. It runs read-only in ash_new's folder and reads the Lake Step's log, ash_new's job records and the Health reports.
- [ ] The Health Step runs only when the Lake Step failed or the Health report flags something. Otherwise it skips itself.
- [ ] Its output is checked against a schema: a diagnosis, a proposed fix as text (never applied), and the evidence it read.
- [ ] The Brief shows the diagnosis and the proposed fix under the Data gate's verdict. When the Health Agent fails, the Brief says so.
- [ ] Codex's read-only sandbox is confirmed to hold on Windows. If it doesn't, Claude Code becomes the Health Agent's main Worker.
- [ ] Step tests:
  - it skips itself when the Lake is healthy;
  - it runs after a failed Lake Step, and after a flag;
  - it records a failure once its fallback fails too.
