# 12: Schedule

**What to build:** Saransh runs `agents schedule install` once and the daily Pipeline then runs by itself Monday to Friday at 05:30 on the Mac's clock (03:00 IST), or when the Mac next wakes if it was asleep. See the PRD's "Schedule".

**Blocked by:** 01: Run skeleton: fetch and list new commits

**Status:** ready-for-agent

- [ ] A Schedule definition names the Pipeline, days and local time; the daily Schedule is Monday to Friday at 05:30.
- [ ] `agents schedule install` writes and loads the launchd entry from the Schedule definitions; running it again replaces the entry instead of duplicating it.
- [ ] The launchd entry sets its own PATH so the Worker CLIs and git are found, since launchd doesn't load the shell profile.
- [ ] A scheduled time missed while the Mac slept runs once on wake.
- [ ] A scheduled start while a manual Run is active is refused by the lock and recorded.
- [ ] Tests check the generated launchd entry for a given Schedule definition without loading it.
