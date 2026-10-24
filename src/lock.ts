import { closeSync, ftruncateSync, mkdirSync, readFileSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from './paths.ts'
import { openLocked, stopRecordedProcesses } from './processes.ts'
import { failAbandonedRuns } from './run.ts'

const lockFile = () => join(dataDir(), 'run.lock')

/** Thrown when the lock refuses a Run, or a Step, because another Run is active. */
export class RunActiveError extends Error {}

/**
 * Takes the lock that lets only one Run be active at a time, returning a function that releases
 * it. Throws if another Run is active. The lock is a file lock, which ends with the process
 * holding it, so a Run whose process died never blocks the next one, and two processes can never
 * both hold it. Before taking over, whatever an earlier Run left running is stopped, and a Run
 * that died without releasing the lock is recorded as failed.
 */
export function acquireLock(): () => void {
  mkdirSync(dataDir(), { recursive: true })
  const fd = openLocked(lockFile())
  if (fd === null) {
    const pid = readFileSync(lockFile(), 'utf8').trim()
    throw new RunActiveError(`A Run is already active${pid ? ` (pid ${pid})` : ''}; try again once it ends`)
  }
  try {
    stopRecordedProcesses()
    // The file holds the pid of whoever holds the lock, and is emptied on release, so only a process that died leaves one.
    if (readFileSync(lockFile(), 'utf8').trim()) failAbandonedRuns()
    ftruncateSync(fd)
    writeSync(fd, `${process.pid}\n`, 0)
  } catch (error) {
    closeSync(fd)
    throw error
  }
  return () => {
    ftruncateSync(fd)
    closeSync(fd)
  }
}
