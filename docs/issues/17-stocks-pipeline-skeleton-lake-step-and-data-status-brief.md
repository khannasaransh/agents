# 17: Stocks Pipeline skeleton: the Lake Step and a data-status Stocks Brief

**What to build:** `agents run stocks` brings the Lake up to date and writes a Stocks Brief that says how fresh and healthy the Lake is. This is the first slice through the `pd` contract between the two repos. See the stocks Pipeline PRD's "Stocks Pipeline Steps" (Lake, Brief) and ADR 0002.

**Repos:** agents, ash_new

**Blocked by:** 15: Fix the stuck refresh and the dying process pool; 16: The Pipeline runs on Windows

**Status:** done

- [x] A stocks Pipeline with Lake and Brief Steps runs with `agents run stocks`. It has the same Run folders, lock, Step records and logs as the daily Pipeline.
- [x] `pd` gets a status command whose JSON gives:
  - each market's latest session in the Lake;
  - each market's last finished session by its calendar;
  - the last refresh's outcome;
  - the Health report's verdict and flags;
  - the Data gate's verdict, with its reasons.
- [x] The Data gate checks only India and the US. Hong Kong's data never fails it.
- [x] The status command's JSON Schema lives in ash_new, and ash_new's tests check the command's output against it.
- [x] The Lake Step:
  - raises a To-do if ash_new's own schedule is on;
  - clears a refresh left running by a dead process, with ticket 15's command;
  - runs `pd daily` and retries it once on failure;
  - records the status JSON;
  - fails if the retry fails too.
- [x] ash_new's own schedule is turned off and its Task Scheduler task removed (ADR 0002).
- [x] ash_new's decisions file records the answers to its five open decisions: 1b, 2a, 3a, 4a and 5a.
- [x] The Brief Step writes the Stocks Brief as one self-contained HTML file in the Run folder.
  - It loads nothing from the internet.
  - It shows the Data gate's verdict, each market's latest session, the flags, the To-dos and Run health.
  - It is written even when the Lake Step failed.
- [x] A dry run doesn't refresh the Lake. It reads the Lake's status as it is.
- [x] The agents repo's stand-in `pd` answers with example files that validate against ash_new's schemas. A test checks those copies against ash_new's schemas whenever ash_new is on the machine.
- [x] Step tests with the stand-in `pd` cover:
  - a healthy Lake;
  - a refresh that fails, then succeeds on retry;
  - a refresh that fails twice;
  - a stuck refresh that gets cleared;
  - ash_new's schedule found on.

**Notes:**

- The stocks Pipeline is `pipelines/stocks.ts`: Lake, then Brief. A Pipeline's own Steps live in `steps/<pipeline>/`, so the stocks Brief is `steps/stocks/brief.ts` beside the daily Pipeline's `steps/brief.ts`; a Step not found there is taken from `steps/`. A Pipeline definition now names the file its Brief writes, which `agents run` prints.
- The Pipeline reaches ash_new only through `src/pd.ts`. It runs the first `pd` on PATH, else the one in ash_new's `.venv`; ash_new's folder is `ASH_NEW_FOLDER` in the env file, else `backend/portfolio-dashboard` beside this repo.
- **In ash_new:**
  - `pd status` is `pdash/status.py`. Its JSON gives each market's latest data session and its last finished session by its calendar, the newest refresh job, the latest Health report's verdict, each market's problems and flag counts, and every flag. It also gives the Data gate's verdict with its reasons and `own_schedule`: the API's schedule setting and whether its Windows task is registered. It reads the app database without migrating it, so it records nothing (a dry run reads only this), and it exits 0 whatever the gate says.
  - The gate fails when no refresh is recorded or the newest didn't succeed, when there is no Health report (or it can't be read), when the report fails India or the US, or when either market is behind its last finished session. A flag alone fails nothing. The regions it checks are those with `data_gate: true` in `config/regions.yaml` (India and the US), as ash_new's ADR 0010 keeps regions in configuration.
  - Its schemas are in `contract/` (`status.schema.json`, and `clear-refresh.schema.json` for ticket 15's command). They use only the part of JSON Schema that `src/schema.ts` here checks, which ash_new's `tests/test_contract.py` enforces. `tests/test_status.py` and `tests/test_clear_refresh.py` validate each output with `jsonschema`, a new dev dependency.
  - The schedule is off in `config/settings.toml` (`[schedule] enabled = false`). Its Task Scheduler task wasn't registered on this machine, so there was nothing to remove.
  - The answers are recorded under each decision in `docs/decisions/pending.md`. The decisions stay there until issue 20 builds 1b and 2a.
- **The Lake Step** (`steps/stocks/lake.ts`):
  - It runs `pd clear-refresh`, then `pd daily`, retrying once, then `pd status`, which it writes as `lake/status.json`. A refusal or a crash of `pd clear-refresh` is logged, and the refresh still runs. `lake.json` records what it cleared, each `pd daily` attempt and whether one succeeded. It is written before the status is read, so it survives a status that can't be read. `pd daily`'s output goes to the Step's log.
  - It reads the schedule from the status it reads last, so it needs no extra call.
  - It skips itself on a re-run once the Lake was refreshed in the Run, unless forced. `pd daily` gets `AGENTS_LAKE_TIMEOUT_SECONDS` (3 hours by default).
- **To-dos** a Step raises go in `todos/<step>.json` in the Run folder (`src/todos.ts`). Running a Step again replaces its To-dos, and the Brief lists them all.
- **The Stocks Brief** is `brief.html`: inline styles, no scripts, no links outside the Run folder except to Step logs. Each market's flags are in a collapsed list, since the real Lake has hundreds (747 on 25 Oct).
- The stand-in `pd` (`test/helpers.ts`) answers with `test/pd/<command>.<case>.json`. `test/stocks.test.ts` checks every example against ash_new's schema for its command, and checks that every command in the contract has an example. It is skipped when ash_new isn't on the machine.
