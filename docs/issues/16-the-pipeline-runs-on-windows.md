# 16: The Pipeline runs on Windows

**What to build:** The Pipeline machinery works on the Windows machine as it does on the Mac: the Run lock, the process records, stopping what a dead Run left running, starting the Worker CLIs and git, and the tests. Today it runs only on macOS. Its file lock uses a macOS-only flag and throws on any other platform, it stops processes by process group, and the tests' stand-ins and Tools are `sh` scripts. This ticket prepares the ground for the stocks Pipeline. See the stocks Pipeline PRD's "Shape".

**Repos:** agents

**Blocked by:** None (can start immediately)

**Status:** done

- [x] The Run lock and the process records hold on Windows with the same guarantee as on macOS: a record that is still locked belongs to something still running.
- [x] Stopping a dead Run's processes stops each one's whole process tree on Windows.
- [x] Steps and Workers start the Worker CLIs and git as they are installed on Windows, including npm's `.cmd` shims, without going through a shell.
- [x] The test suite passes on Windows. Its stand-in CLIs, Tools and git helpers work on both platforms.
- [x] Node 26 runs the repo on this machine, which had 24.17.0 (the repo needed 25 when this was written; it now needs 26, the current line). An older Node is refused with a message naming the version needed.
- [x] Nothing changes on macOS. The suite still passes there.

**Notes:**

- **Checked on the Mac on 9 November 2026.** Two tests failed only when the whole suite ran, never on their own: the lock test that waits for an abandoned Run's Codex stand-in to start (5s), and the review test whose 1s Agent timeout also covered the Claude Code fallback, which under the suite's load timed out before its stand-in had even started. Both waits were made longer, to 30s and 5s. The suite then passed twice in a row on the Mac: 470 passed and 7 skipped, 5 of them Windows-only and 2 needing `ash_new`'s contract, which isn't on the Mac.
