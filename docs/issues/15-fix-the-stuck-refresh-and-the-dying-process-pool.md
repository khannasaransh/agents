# 15: Fix the stuck refresh and the dying process pool

**What to build:** The Lake is current again, and one crash can no longer block it. The cause of 16 Oct's `BrokenProcessPool` failure is found and fixed. The refresh started on 18 Oct, still marked running, is cleared. A `pd` command clears any refresh whose process is gone. See the stocks Pipeline PRD's "Data, Corrections and Quarantine".

**Repos:** ash_new · **Mirrored in:** ash_new ticket 50 (keep both in step)

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [x] The cause of the 16 Oct refresh's `BrokenProcessPool: A process in the process pool was terminated abruptly` is found, written up, and fixed. Where it can be reproduced, a test reproduces it.
- [x] A `pd` command clears a refresh job marked running whose process no longer exists. It marks the job failed with a reason, frees the refresh lock, and writes its result as JSON. While the job's process is alive, it refuses.
- [x] The 18 Oct job is cleared this way. `pd daily` then completes and brings every region's prices, fundamentals, panels and Health report up to date.
- [x] Tests:
  - a refresh whose process is gone is cleared;
  - a refresh whose process is running is left alone.
