# 12: Schedule

**What to build:** Saransh runs `agents schedule install` once and the daily Pipeline then runs by itself Monday to Friday at 05:30 on the Mac's clock (03:00 IST), or when the Mac next wakes if it was asleep. See the PRD's "Schedule".

**Blocked by:** 01: Run skeleton: fetch and list new commits

**Status:** done

- [x] A Schedule definition names the Pipeline, days and local time; the daily Schedule is Monday to Friday at 05:30.
- [x] `agents schedule install` writes and loads the launchd entry from the Schedule definitions; running it again replaces the entry instead of duplicating it.
- [x] The launchd entry sets its own PATH so the Worker CLIs and git are found, since launchd doesn't load the shell profile.
- [x] A scheduled time missed while the Mac slept runs once on wake.
- [x] A scheduled start while a manual Run is active is refused by the lock and recorded.
- [x] Tests check the generated launchd entry for a given Schedule definition without loading it.

**Notes:**

- Schedule definitions live in `schedules/`, one file each, named like the Pipelines: `schedules/daily.ts` is the daily Schedule.
- `agents schedule install` writes `~/Library/LaunchAgents/local.agents.<schedule>.plist` for each Schedule, unloading any loaded entry of that label first, waiting until launchd has let go of it, and loading the new one with `launchctl bootstrap gui/<uid>`. It removes the `local.agents.*` entries of Schedules no longer defined. Unloading an entry stops a Run it started, so install takes the Run lock and refuses while a Run is active. It refuses on anything but macOS.
- The entry's PATH is the installing shell's PATH, with node's own folder first (the Worker CLIs are node scripts) and the system folders after it. Install names any of git, claude, codex and agy it can't find on that PATH. The PATH and node's full path are fixed at install, so install again after moving or upgrading node.
- The entry runs `node src/cli.ts run <pipeline> --scheduled` from the agents repo, by node's full path. It pins `AGENTS_DATA_DIR` to the data area install used, so a scheduled Run uses the same lock and data. launchd's own output goes to `data/launchd/<schedule>.log`, which install creates, since launchd doesn't.
- The entry starts only on `StartCalendarInterval` times, with no `RunAtLoad`, so installing starts nothing. launchd runs a time missed while the Mac slept once on wake, coalescing several missed times into one start. A time missed while the Mac was off is not run.
- A scheduled Run appends one line to `data/scheduled-starts.log`: the Run it started and how it ended, `refused: A Run is already active (pid N); try again once it ends` when the lock refuses it, or why it failed to start. A Run started by hand writes nothing there.
