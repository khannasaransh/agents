# 18: Windows Schedule

**What to build:** Saransh runs `agents schedule install` once on the Windows machine. From then on, the stocks Pipeline runs by itself Tuesday to Saturday at 07:00 IST. It wakes the machine if it is asleep, and runs as soon as the machine is back if the time was missed. This builds on issue 12's Schedule definitions. See the stocks Pipeline PRD's "Schedule on Windows".

**Repos:** agents

**Blocked by:** 12: Schedule; 17: Stocks Pipeline skeleton: the Lake Step and a data-status Stocks Brief

**Status:** done

- [x] Each Schedule definition names the machine it runs on: the daily Schedule the Mac, the stocks Schedule the Windows machine.
- [x] The stocks Schedule runs Tuesday to Saturday at 09:30 on the Windows machine's clock (Singapore time), which is 07:00 IST.
- [x] On Windows, `agents schedule install` writes and registers the Task Scheduler entry from the Schedule definitions. Running it again replaces the entry instead of adding a second one.
- [x] The entry:
  - wakes the machine to run;
  - starts a missed time as soon as the machine is available;
  - runs only while Saransh is logged on, so no password is stored;
  - sets its own PATH, so Node, uv, git and the Worker CLIs are found.
- [x] Each machine installs only its own Schedules.
- [x] A scheduled start while a Run is active is refused by the lock, and the refusal is recorded.
- [x] Tests check the generated entry for a given Schedule definition, without registering it.

**Notes:**

- A Schedule definition's `machine` is `mac` or `windows`. `agents schedule install` takes the Schedules of the machine it runs on, by platform, and refuses on any other.
- On Windows, install writes each entry to `data/task-scheduler/<schedule>.xml` (UTF-16, as Task Scheduler reads it) and registers it as `\agents\<schedule>` with `schtasks /Create /XML /F`, which replaces an earlier one. It deletes the tasks in `\agents\` of Schedules no longer defined for this machine. Replacing a task doesn't stop a Run it started, so unlike launchd it doesn't take the Run lock.
- **The entry:**
  - a weekly trigger on the Schedule's days, from the install day, at the Schedule's time with no offset, which is the machine's own clock;
  - `WakeToRun`, `StartWhenAvailable`, an `InteractiveToken` logon (logged on only, no password), and no time limit, since the Steps have their own timeouts;
  - `MultipleInstancesPolicy` is `Parallel`, so every start reaches the Run lock, which refuses it and records the refusal in `scheduled-starts.log`. With `IgnoreNew`, Task Scheduler would drop a start silently.
- Task Scheduler can't set environment variables, so the entry runs `node src/cli.ts run <pipeline> --scheduled --env PATH=… --env AGENTS_DATA_DIR=…`, and `agents run` sets each `--env` before the Run starts. The PATH is node's folder, then the installing shell's PATH, then Windows' own folders, each listed once. The arguments are quoted as Windows parses a command line, and a test checks that node reads them back unchanged.
- Install names any of git, claude, codex, agy and uv it can't find on that PATH. It also warns when the power plan doesn't allow wake timers (`powercfg`, Allow wake timers set to Enable on mains power), since then `WakeToRun` can't wake the machine.
- **On this machine** (25 Oct 2026), wake timers are disabled, so install will warn until that is turned on. The generated entry was registered under a scratch name, read back from Task Scheduler and deleted: Task Scheduler accepted it as generated.
- Task Scheduler keeps no output of a task, unlike launchd's log. A scheduled start's outcome is in `scheduled-starts.log`, and each Run's Steps log to its Run folder.
