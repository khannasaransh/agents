// Windows has no process groups, so what a process started is found by walking parent pids in a
// listing of every process. Windows keeps a process's parent's pid after the parent ends, and gives
// pids out again, so a pid counts as a process's parent only when the parent started first.
import { spawnSync } from 'node:child_process'

/** How far a process's recorded start may be from when Windows says it started, in milliseconds. */
const clockSlackMs = 1000

/** Every running process, with its parent's pid and when it started, in milliseconds since the epoch. */
function listProcesses(): { pid: number; parent: number; started: number }[] {
  const listing = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', "Get-CimInstance Win32_Process | ForEach-Object { '{0} {1} {2}' -f $_.ProcessId, $_.ParentProcessId, $_.CreationDate.ToFileTimeUtc() }"],
    { encoding: 'utf8', windowsHide: true },
  )
  // A FILETIME counts 100ns ticks since 1601.
  return listing.stdout
    .split('\n')
    .map((line) => line.trim().split(' ').map(Number))
    .filter((fields) => fields.length === 3 && fields.every(Number.isFinite))
    .map(([pid, parent, ticks]) => ({ pid, parent, started: ticks / 10_000 - 11_644_473_600_000 }))
}

/**
 * The running processes of the tree a process started between `from` and `to` (milliseconds since
 * the epoch) as `pid`: that process, unless it has ended or the pid now belongs to another, and
 * everything it started, and they started, that is still running, whether or not it has ended.
 */
export function processTree(pid: number, from: number, to: number): number[] {
  const processes = listProcesses()
  const root = processes.find((p) => p.pid === pid && p.started >= from - clockSlackMs && p.started <= to + clockSlackMs)
  const tree = root ? [pid] : []
  const visit = (parent: number, after: number) => {
    for (const child of processes) {
      if (child.parent !== parent || child.started < after - clockSlackMs || tree.includes(child.pid)) continue
      tree.push(child.pid)
      visit(child.pid, child.started)
    }
  }
  visit(pid, root?.started ?? from)
  return tree
}

/** Kills a running process with every process it started that is still running. */
export function killTree(pid: number): void {
  spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true })
}

/** Kills each of the processes. */
export function killAll(pids: number[]): void {
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {}
  }
}
