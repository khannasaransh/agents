// Every Step, and every process a Step starts, is recorded in the data area while it runs, so a Run
// that died can't leave work running into the next one. Each record is a lock file locked by the
// process it records, beside a file naming that process: whoever starts the process hands it the
// lock as it starts. A record that is still locked belongs to something still running, so its pid
// is never one the system has since given to an unrelated process.
import { randomUUID } from 'node:crypto'
import { closeSync, constants, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from './paths.ts'
import { killAll, killTree, processTree } from './process-tree.ts'

const windows = process.platform === 'win32'

/** macOS's open(2) flag that takes an exclusive flock(2) on the file as it opens it. */
const O_EXLOCK = 0x20
/** libuv's flag that opens a file on Windows sharing it with no one, until every handle to it is closed. */
const UV_FS_O_EXLOCK = 0x10000000

/**
 * Opens `file`, creating it if needed, holding an exclusive lock on it. The lock lasts until every
 * copy of the descriptor is closed, which a process's end does for it. Returns null while another
 * process holds the lock. On Windows a locked file can't be read, written by another or removed
 * either, so what others need to know goes in a file beside it.
 */
export function openLocked(file: string): number | null {
  if (process.platform !== 'darwin' && !windows) throw new Error('The Pipeline runs only on macOS and Windows, which can lock a file as they open it')
  try {
    return openSync(file, constants.O_RDWR | constants.O_CREAT | (windows ? UV_FS_O_EXLOCK : constants.O_NONBLOCK | O_EXLOCK))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === (windows ? 'EBUSY' : 'EAGAIN')) return null
    throw error
  }
}

interface ProcessRecord {
  pid: number
  /** It leads its own process group, which is stopped with it. On Windows, it is stopped with every process it started. */
  group: boolean
  /** The process that started it. */
  owner: number
  /** It started between these two, in milliseconds since the epoch, which tells it from a later process given its pid on Windows. Missing from records written before Windows was supported. */
  from?: number
  to?: number
}

const recordsDir = () => join(dataDir(), 'processes')

/**
 * Records a process about to start. Give it `fd` as one of its stdio entries so it holds the
 * record's lock, call `started` with its pid once it is spawned, and `ended` once it has ended.
 */
export function recordProcess({ group }: { group: boolean }): { fd: number; started(pid: number | undefined): void; ended(): void } {
  mkdirSync(recordsDir(), { recursive: true })
  const lock = join(recordsDir(), `${randomUUID()}.lock`)
  const fd = openLocked(lock)
  if (fd === null) throw new Error(`Could not lock the new process record ${lock}`)
  const from = Date.now()
  let open = true
  const close = () => {
    if (open) closeSync(fd)
    open = false
  }
  return {
    fd,
    started(pid) {
      if (pid !== undefined) writeFileSync(infoFile(lock), JSON.stringify({ pid, group, owner: process.pid, from, to: Date.now() } satisfies ProcessRecord))
      close()
    },
    ended() {
      close()
      removeRecord(lock)
    },
  }
}

/** The file naming the process a record's lock file is for. */
const infoFile = (lock: string) => lock.replace(/\.lock$/, '.json')

/**
 * Removes a record, unless something it started still holds its lock: Windows can't remove a file
 * another process has open, and that record is left for the next Run to stop.
 */
function removeRecord(lock: string): void {
  try {
    rmSync(lock, { force: true })
  } catch (error) {
    if (['EBUSY', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) return
    throw error
  }
  rmSync(infoFile(lock), { force: true })
}

/**
 * Stops every recorded process still running, with everything in its process group (on Windows,
 * every process it started), and waits until they have ended. With `owner`, only the processes that
 * process started. Throws if one doesn't end.
 */
export function stopRecordedProcesses({ owner }: { owner?: number } = {}): void {
  const deadline = Date.now() + 10_000
  for (;;) {
    const running = runningRecords().filter(({ record }) => owner === undefined || record?.owner === owner)
    if (!running.length) return
    if (Date.now() > deadline) {
      const which = running.map(({ lock, record }) => (record ? `pid ${record.pid}` : lock)).join(', ')
      throw new Error(`Could not stop what an earlier Run left running: ${which}`)
    }
    for (const { record } of running) if (record) stop(record)
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50)
  }
}

/**
 * The records whose process is still running. Records of processes that have ended are removed. A
 * record written before Windows was supported is its own lock, holding what is now beside it.
 */
function runningRecords(): { lock: string; record: ProcessRecord | null }[] {
  if (!existsSync(recordsDir())) return []
  const names = readdirSync(recordsDir())
  const legacy = names.filter((name) => name.endsWith('.json') && !names.includes(name.replace(/\.json$/, '.lock')))
  return [...names.filter((name) => name.endsWith('.lock')), ...legacy].flatMap((name) => {
    const lock = join(recordsDir(), name)
    const info = name.endsWith('.lock') ? infoFile(lock) : lock
    const fd = openLocked(lock)
    if (fd !== null) {
      closeSync(fd)
      rmSync(lock, { force: true })
      rmSync(info, { force: true })
      return []
    }
    const text = existsSync(info) ? readFileSync(info, 'utf8') : ''
    const record: ProcessRecord | null = text ? JSON.parse(text) : null
    // Its process group is gone (on Windows, its process tree), so whatever still holds the lock left
    // it and is out of reach.
    if (record && !exists(record)) {
      rmSync(lock, { force: true })
      rmSync(info, { force: true })
      return []
    }
    return [{ lock, record }]
  })
}

/** The running processes of a recorded process's tree on Windows, or null when its record can't tell its pid from a later process's. */
const treeOf = ({ pid, from, to }: ProcessRecord) => (from === undefined || to === undefined ? null : processTree(pid, from, to))

/** Whether the recorded process, or anything in its process group (on Windows, its process tree), is still running. */
function exists(record: ProcessRecord): boolean {
  if (windows) {
    const tree = treeOf(record)
    if (tree) return tree.length > 0
  }
  try {
    process.kill(record.group && !windows ? -record.pid : record.pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Kills the recorded process, with its process group, or on Windows with its process tree. */
function stop(record: ProcessRecord): void {
  if (windows) {
    const tree = treeOf(record)
    return tree ? killAll(tree) : killTree(record.pid)
  }
  try {
    process.kill(record.group ? -record.pid : record.pid, 'SIGKILL')
  } catch {}
}
