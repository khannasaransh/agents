# 18: Windows Schedule

**What to build:** Saransh runs `agents schedule install` once on the Windows machine. From then on, the stocks Pipeline runs by itself Tuesday to Saturday at 07:00 IST. It wakes the machine if it is asleep, and runs as soon as the machine is back if the time was missed. This builds on issue 12's Schedule definitions. See the stocks Pipeline PRD's "Schedule on Windows".

**Repos:** agents

**Blocked by:** 12: Schedule; 17: Stocks Pipeline skeleton: the Lake Step and a data-status Stocks Brief

**Status:** ready-for-agent

- [ ] Each Schedule definition names the machine it runs on: the daily Schedule the Mac, the stocks Schedule the Windows machine.
- [ ] The stocks Schedule runs Tuesday to Saturday at 09:30 on the Windows machine's clock (Singapore time), which is 07:00 IST.
- [ ] On Windows, `agents schedule install` writes and registers the Task Scheduler entry from the Schedule definitions. Running it again replaces the entry instead of adding a second one.
- [ ] The entry:
  - wakes the machine to run;
  - starts a missed time as soon as the machine is available;
  - runs only while Saransh is logged on, so no password is stored;
  - sets its own PATH, so Node, uv, git and the Worker CLIs are found.
- [ ] Each machine installs only its own Schedules.
- [ ] A scheduled start while a Run is active is refused by the lock, and the refusal is recorded.
- [ ] Tests check the generated entry for a given Schedule definition, without registering it.
