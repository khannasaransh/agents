import { spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { acquireLock } from './lock.ts'
import { agentsRoot, runDir } from './paths.ts'
import { recordProcess, stopRecordedProcesses } from './processes.ts'
import { createRun, finalStatus, readRun, writeRun, type RunRecord, type StepRecord } from './run.ts'

/** A Pipeline definition: the Steps it runs, in order. */
export interface Pipeline {
  steps: string[]
}

/**
 * Starts a Run of the named Pipeline and runs every Step in order, even after one fails.
 * Refuses to start while another Run is active. A dry run runs every Agent Step on the fake Worker.
 */
export async function runPipeline(name: string, { dryRun = false } = {}): Promise<RunRecord> {
  const pipeline: Pipeline = (await import(pathToFileURL(definitionFile('pipelines', name)).href)).default
  const release = acquireLock()
  try {
    const run = createRun(name, pipeline.steps, { dryRun })
    try {
      for (const step of pipeline.steps) await runStep(run.id, step)
      const done = readRun(run.id)
      done.status = finalStatus(done.steps)
      done.endedAt = new Date().toISOString()
      writeRun(done)
      return done
    } catch (error) {
      writeRun({ ...readRun(run.id), status: 'failed', endedAt: new Date().toISOString() })
      throw error
    }
  } finally {
    release()
  }
}

/** Runs one Step inside an existing Run, as `agents step` does. Refuses while a Run is active. */
export async function runSingleStep(runId: string, name: string, options: { force?: boolean } = {}): Promise<StepRecord> {
  const release = acquireLock()
  try {
    return await runStep(runId, name, options)
  } finally {
    release()
  }
}

/**
 * Runs one Step of a Run as its own process, appending its output to the Step's log and keeping
 * the Run record up to date. The Step's exit code alone decides success.
 */
async function runStep(runId: string, name: string, { force = false } = {}): Promise<StepRecord> {
  const run = readRun(runId)
  const step = run.steps.find((s) => s.name === name)
  if (!step) throw new Error(`Step ${name} is not part of Run ${runId} (${run.pipeline} Pipeline)`)
  const script = definitionFile('steps', name)

  step.status = 'running'
  step.startedAt = new Date().toISOString()
  delete step.endedAt
  writeRun(run)

  const logFile = join(runDir(runId), step.log)
  mkdirSync(dirname(logFile), { recursive: true })
  const log = openSync(logFile, 'a')
  writeSync(log, `--- ${name} started ${step.startedAt}${force ? ' (forced)' : ''}\n`)
  const args = [script, '--run', runId, ...(force ? ['--force'] : [])]
  const record = recordProcess({ group: false })
  const child = spawn(process.execPath, args, { stdio: ['ignore', log, log, record.fd] })
  record.started(child.pid)
  const exitCode = await new Promise<number | null>((resolve) => {
    child.on('error', (error) => {
      writeSync(log, `Could not start Step: ${error.message}\n`)
      resolve(null)
    })
    child.on('close', resolve)
  })
  record.ended()
  // A Step that died can leave what it started running.
  if (child.pid !== undefined) stopRecordedProcesses({ owner: child.pid })

  step.status = exitCode === 0 ? 'succeeded' : 'failed'
  step.endedAt = new Date().toISOString()
  writeSync(log, `--- ${name} ${step.status} ${step.endedAt} (exit ${exitCode})\n`)
  closeSync(log)
  // Re-running a Step after its Run has ended can change how the Run ended.
  if (run.status !== 'running') run.status = finalStatus(run.steps)
  writeRun(run)
  return step
}

/** The file defining the named Pipeline or Step. */
function definitionFile(folder: 'pipelines' | 'steps', name: string): string {
  const file = join(agentsRoot, folder, `${name}.ts`)
  const kind = folder === 'pipelines' ? 'Pipeline' : 'Step'
  if (!/^[a-z][a-z0-9-]*$/.test(name) || !existsSync(file)) throw new Error(`Unknown ${kind}: ${name}`)
  return file
}
