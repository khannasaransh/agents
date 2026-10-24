# 17: Stocks Pipeline skeleton: the Lake Step and a data-status Stocks Brief

**What to build:** `agents run stocks` brings the Lake up to date and writes a Stocks Brief that says how fresh and healthy the Lake is. This is the first slice through the `pd` contract between the two repos. See the stocks Pipeline PRD's "Stocks Pipeline Steps" (Lake, Brief) and ADR 0002.

**Repos:** agents, ash_new

**Blocked by:** 15: Fix the stuck refresh and the dying process pool; 16: The Pipeline runs on Windows

**Status:** ready-for-agent

- [ ] A stocks Pipeline with Lake and Brief Steps runs with `agents run stocks`. It has the same Run folders, lock, Step records and logs as the daily Pipeline.
- [ ] `pd` gets a status command whose JSON gives:
  - each market's latest session in the Lake;
  - each market's last finished session by its calendar;
  - the last refresh's outcome;
  - the Health report's verdict and flags;
  - the Data gate's verdict, with its reasons.
- [ ] The Data gate checks only India and the US. Hong Kong's data never fails it.
- [ ] The status command's JSON Schema lives in ash_new, and ash_new's tests check the command's output against it.
- [ ] The Lake Step:
  - raises a To-do if ash_new's own schedule is on;
  - clears a refresh left running by a dead process, with ticket 15's command;
  - runs `pd daily` and retries it once on failure;
  - records the status JSON;
  - fails if the retry fails too.
- [ ] ash_new's own schedule is turned off and its Task Scheduler task removed (ADR 0002).
- [ ] ash_new's decisions file records the answers to its five open decisions: 1b, 2a, 3a, 4a and 5a.
- [ ] The Brief Step writes the Stocks Brief as one self-contained HTML file in the Run folder.
  - It loads nothing from the internet.
  - It shows the Data gate's verdict, each market's latest session, the flags, the To-dos and Run health.
  - It is written even when the Lake Step failed.
- [ ] A dry run doesn't refresh the Lake. It reads the Lake's status as it is.
- [ ] The agents repo's stand-in `pd` answers with example files that validate against ash_new's schemas. A test checks those copies against ash_new's schemas whenever ash_new is on the machine.
- [ ] Step tests with the stand-in `pd` cover:
  - a healthy Lake;
  - a refresh that fails, then succeeds on retry;
  - a refresh that fails twice;
  - a stuck refresh that gets cleared;
  - ash_new's schedule found on.
