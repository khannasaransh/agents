# 19: Health Agent

**What to build:** When the Lake Step fails or the Health report flags something, a read-only Health Agent works out why and proposes a fix. The Stocks Brief shows its diagnosis, so Saransh starts from a diagnosis rather than a log. See the stocks Pipeline PRD's Health Step and "Agents".

**Repos:** agents

**Blocked by:** 17: Stocks Pipeline skeleton: the Lake Step and a data-status Stocks Brief

**Status:** done

- [x] A Health Agent runs on Codex, with Claude Code as fallback. It runs read-only in ash_new's folder and reads the Lake Step's log, ash_new's job records and the Health reports.
- [x] The Health Step runs only when the Lake Step failed or the Health report flags something. Otherwise it skips itself.
- [x] Its output is checked against a schema: a diagnosis, a proposed fix as text (never applied), and the evidence it read.
- [x] The Brief shows the diagnosis and the proposed fix under the Data gate's verdict. When the Health Agent fails, the Brief says so.
- [x] Codex's read-only sandbox is confirmed to hold on Windows. If it doesn't, Claude Code becomes the Health Agent's main Worker.
- [x] Step tests:
  - it skips itself when the Lake is healthy;
  - it runs after a failed Lake Step, and after a flag;
  - it records a failure once its fallback fails too.

**Notes:**

- The stocks Pipeline is now Lake, Health, Brief. The Health Step is `steps/stocks/health.ts`, and the Agent is `agents/health/` (Claude Code `opus`, then Codex `gpt-6-astra`, both at high effort, read-only, 15 minutes and 40 turns; see Codex's sandbox below for why Claude Code comes first).
- **When it runs:** when the Lake Step didn't succeed, the Lake's status couldn't be read, the Data gate failed, or the Health report isn't `ok` or has any flag. The Data gate is in the list too, so a market behind its last finished session after a refresh that worked still gets a diagnosis. Otherwise it skips itself and drops a diagnosis an earlier run of it made in the Run.
  - Any flag counts, so on today's Lake (747 flags, 25 Oct) it runs every day until issue 20's Quarantines and dismissals give the flags somewhere to go. `test/pd/status.clean.json` is a status with no flags, for the healthy case.
- **What it is given:** why it was called, `lake.json`, the last 300 lines of the Lake Step's log, and the Lake's status as `pd status` printed it, flags and all. It runs in ash_new's folder (`ASH_NEW_FOLDER`), and the Step fails, saying where it looked, when that folder isn't there. Its instructions point it at ash_new's code, `config/settings.toml`, the Health reports in `data/lake/health/`, the job logs in `data/logs/jobs/<id>.jsonl` and the jobs table in `data/app.db`. They tell it never to run `pd` or `uv`: even `pd status` opens the database.
- **What it answers:** `diagnosis`, `fix` and `evidence` (each with `source`, a path from ash_new's folder or an input's name, and what it `shows`). The Step records it as `health.json` with why it ran and a fingerprint of what it was given. A re-run skips itself while that fingerprint holds, unless forced, and diagnoses again once the Lake Step changed its inputs. A failure on both Workers is recorded as `status: "failed"` with both errors, and fails the Step.
- **The Brief** shows "Health Agent's diagnosis" right under the Data gate's verdict, then "Proposed fix, not applied" and a collapsed list of the evidence. When the Agent failed, or the Step failed before recording anything, it says so, with a link to the Step's log.
- **Codex's sandbox on Windows:** checked on this machine with Codex 0.155.1, using the Worker's own command line. Run as it was, Codex refused every command, even `Get-Content`. The Worker passes `--ignore-user-config`, which also drops the `[windows] sandbox` setting, and without a Windows sandbox Codex refuses everything it can't sandbox. That also hit the Reviewer on Windows.
  - The Codex Worker now passes `windows.sandbox="unelevated"` (a restricted token, which needs no setup on the machine). Other platforms are expected to ignore it; that is unchecked.
  - With no deny rules, it holds. Reads work, in the folder Codex runs in and outside it: `Get-Content`, `Select-String`, `git --version`. Every write is denied: PowerShell redirection, `Set-Content`, `cmd /c echo >`, Python's `open(..., 'w')`, `git init` and `apply_patch`, inside and outside that folder. The network is cut off too (`curl.exe` fails). An Agent's write folders still work: with a write folder of `.`, those writes succeed there, while a write outside it and the network are still denied.
  - **But a real Agent call fails at once.** The Worker denies every Tool the Agent doesn't declare (the Docs Agent's Tools are always in the Agents folder), and Codex refuses to start: "windows unelevated restricted-token sandbox cannot enforce deny-read restrictions directly; refusing to run unsandboxed". The sandbox check above ran with no Tools to deny, so it missed this. A live run of the Health Agent against the real Lake caught it.
  - **So Claude Code is the Health Agent's main Worker, as this issue says to do, with Codex as fallback.** In that live run, Claude Code (the fallback then) gave a schema-valid diagnosis of the real Lake's 747 flags. It grouped them by cause, read the job logs, the Health reports and ash_new's code, and named the functions to change. Nothing in ash_new's folder changed during the run.
  - Keeping `unelevated` still helps: a Codex call that would deny a Tool now fails at once and falls back. Without it, Codex refuses every command but still answers, which can pass the output schema with nothing read. The Reviewer, which starts on Codex, falls back to Claude Code on Windows the same way.
  - **Not yet checked:** `"elevated"` may enforce deny-read rules and bring Codex back. It needs a one-time setup run as administrator. With no deny rules it held as well as unelevated, but its sandbox user couldn't start the Python in Saransh's AppData.
