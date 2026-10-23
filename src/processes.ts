// Every Step, and every process a Step starts, is recorded in the data area while it runs, so a Run
// that died can't leave work running into the next one. Each record is a file locked by the process
// it records: whoever starts the process hands it the lock as it starts, and whatever that process
// starts inherits it. A record that is still locked belongs to something still running, so its pid
// is never one the system has since given to an unrelated process.
import { randomUUID } from 'node:crypto'
import { closeSync, constants, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from './paths.ts'

/** macOS's open(2) flag that takes an exclusive flock(2) on the file as it opens it. */
const O_EXLOCK = 0x20

/**
 * Opens `file`, creating it if needed, holding an exclusive lock on it. The lock lasts until every
 * copy of the descriptor is closed, which a process's end does for it. Returns null while another
 * process holds the lock.
 */
export function openLocked(file: string): number | null {
  if (process.platform !== 'darwin') throw new Error('The Pipeline runs only on macOS, whose open(2) can lock a file as it opens it')
  try {
    return openSync(file, constants.O_RDWR | constants.O_CREAT | constants.O_NONBLOCK | O_EXLOCK)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EAGAIN') return null
    throw error
  }
}

interface ProcessRecord {
  pid: number
  /** It leads its own process group, which is stopped with it. */
  group: boolean
  /** The process that started it. */
  owner: number
}

const recordsDir = () => join(dataDir(), 'processes')

/**
 * Records a process about to start. Give it `fd` as one of its stdio entries so it holds the
 * record's lock, call `started` with its pid once it is spawned, and `ended` once it has ended.
 */
export function recordProcess({ group }: { group: boolean }): { fd: number; started(pid: number | undefined): void; ended(): void } {
  mkdirSync(recordsDir(), { recursive: true })
  const file = join(recordsDir(), `${randomUUID()}.json`)
  const fd = openLocked(file)
  if (fd === null) throw new Error(`Could not lock the new process record ${file}`)
  let open = true
  const close = () => {
    if (open) closeSync(fd)
    open = false
  }
  return {
    fd,
    started(pid) {
      if (pid !== undefined) writeSync(fd, JSON.stringify({ pid, group, owner: process.pid } satisfies ProcessRecord))
      close()
    },
    ended() {
      close()
      rmSync(file, { force: true })
    },
  }
}

/**
 * Stops every recorded process still running, with everything in its process group, and waits
 * until they have ended. With `owner`, only the processes that process started. Throws if one
 * doesn't end.
 */
export function stopRecordedProcesses({ owner }: { owner?: number } = {}): void {
  const deadline = Date.now() + 10_000
  for (;;) {
    const running = runningRecords().filter(({ record }) => owner === undefined || record?.owner === owner)
    if (!running.length) return
    if (Date.now() > deadline) {
      const which = running.map(({ file, record }) => (record ? `pid ${record.pid}` : file)).join(', ')
      throw new Error(`Could not stop what an earlier Run left running: ${which}`)
    }
    for (const { record } of running) if (record) signal(record, 'SIGKILL')
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50)
  }
}

/** The records whose process is still running. Records of processes that have ended are removed. */
function runningRecords(): { file: string; record: ProcessRecord | null }[] {
  if (!existsSync(recordsDir())) return []
  return readdirSync(recordsDir()).flatMap((name) => {
    const file = join(recordsDir(), name)
    const fd = openLocked(file)
    if (fd !== null) {
      closeSync(fd)
      rmSync(file, { force: true })
      return []
    }
    const text = readFileSync(file, 'utf8')
    const record: ProcessRecord | null = text ? JSON.parse(text) : null
    // Its process group is gone, so whatever still holds the lock left the group and is out of reach.
    if (record && !signal(record, 0)) {
      rmSync(file, { force: true })
      return []
    }
    return [{ file, record }]
  })
}

/** Sends `signal` to the recorded process, or its process group. Returns whether it exists. */
function signal({ pid, group }: ProcessRecord, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(group ? -pid : pid, signal)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}
