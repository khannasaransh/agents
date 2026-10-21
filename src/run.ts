import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { readJson, writeJson } from './files.ts'
import { runDir, runsDir } from './paths.ts'

export type StepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped'

/** Partial: some Steps failed or were skipped. Failed: the Run couldn't start or record itself. */
export type RunStatus = 'running' | 'succeeded' | 'partial' | 'failed'

export interface StepRecord {
  name: string
  status: StepStatus
  startedAt?: string
  endedAt?: string
  /** Relative to the Run folder. */
  log: string
}

/** The Run record, kept as run.json in the Run folder. */
export interface RunRecord {
  id: string
  pipeline: string
  status: RunStatus
  /** Every Agent Step runs on the fake Worker. */
  dryRun?: boolean
  startedAt: string
  endedAt?: string
  steps: StepRecord[]
}

const runFile = (runId: string) => join(runDir(runId), 'run.json')

export function readRun(runId: string): RunRecord {
  if (!existsSync(runFile(runId))) throw new Error(`No Run ${runId} in ${runsDir()}`)
  return readJson(runFile(runId))
}

export function writeRun(run: RunRecord): void {
  writeJson(runFile(run.id), run)
}

/** Creates the Run folder, named by local start date and time, and its record. */
export function createRun(pipeline: string, steps: string[], { dryRun = false } = {}): RunRecord {
  const now = new Date()
  mkdirSync(runsDir(), { recursive: true })
  const base = localStamp(now)
  let id = base
  for (let n = 2; ; n++) {
    try {
      mkdirSync(runDir(id))
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      id = `${base}-${n}`
    }
  }
  const run: RunRecord = {
    id,
    pipeline,
    status: 'running',
    dryRun,
    startedAt: now.toISOString(),
    steps: steps.map((name) => ({ name, status: 'pending', log: join('logs', `${name}.log`) })),
  }
  writeRun(run)
  return run
}

/** Marks as failed every Run still recorded as running. Call only while no Run is active. */
export function failAbandonedRuns(): void {
  if (!existsSync(runsDir())) return
  for (const id of readdirSync(runsDir())) {
    if (!existsSync(runFile(id))) continue
    const run = readRun(id)
    if (run.status === 'running') writeRun({ ...run, status: 'failed' })
  }
}

/** The Steps that did not succeed: failed, skipped, or never finished. */
export function stepsNotSucceeded(steps: StepRecord[]): StepRecord[] {
  return steps.filter((s) => s.status !== 'succeeded')
}

/** The status a finished Run ends with, given its Steps. */
export function finalStatus(steps: StepRecord[]): RunStatus {
  return stepsNotSucceeded(steps).length ? 'partial' : 'succeeded'
}

function localStamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}
