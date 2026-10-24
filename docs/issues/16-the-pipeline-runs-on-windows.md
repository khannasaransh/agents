# 16: The Pipeline runs on Windows

**What to build:** The Pipeline machinery works on the Windows machine as it does on the Mac: the Run lock, the process records, stopping what a dead Run left running, starting the Worker CLIs and git, and the tests. Today it runs only on macOS. Its file lock uses a macOS-only flag and throws on any other platform, it stops processes by process group, and the tests' stand-ins and Tools are `sh` scripts. This ticket prepares the ground for the stocks Pipeline. See the stocks Pipeline PRD's "Shape".

**Repos:** agents

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] The Run lock and the process records hold on Windows with the same guarantee as on macOS: a record that is still locked belongs to something still running.
- [ ] Stopping a dead Run's processes stops each one's whole process tree on Windows.
- [ ] Steps and Workers start the Worker CLIs and git as they are installed on Windows, including npm's `.cmd` shims, without going through a shell.
- [ ] The test suite passes on Windows. Its stand-in CLIs, Tools and git helpers work on both platforms.
- [ ] Node 25 runs the repo on this machine, which has 24.17.0 today. An older Node is refused with a message naming the version needed.
- [ ] Nothing changes on macOS. The suite still passes there.
