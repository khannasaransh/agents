import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from './paths.ts'
import { failAbandonedRuns } from './run.ts'

const lockFile = () => join(dataDir(), 'run.lock')

/**
 * Takes the lock that lets only one Run be active at a time, returning a function that releases
 * it. Throws if another Run is active. A lock left by a Run whose process died is cleared, and
 * that Run is recorded as failed.
 */
export function acquireLock(): () => void {
  mkdirSync(dataDir(), { recursive: true })
  try {
    writeFileSync(lockFile(), `${process.pid}\n`, { flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const pid = Number(readFileSync(lockFile(), 'utf8'))
    if (isAlive(pid)) throw new Error(`A Run is already active (pid ${pid}); try again once it ends`)
    rmSync(lockFile())
    failAbandonedRuns()
    writeFileSync(lockFile(), `${process.pid}\n`, { flag: 'wx' })
  }
  return () => rmSync(lockFile(), { force: true })
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}
