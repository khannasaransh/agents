import { existsSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { runDir } from './paths.ts'

export interface StepContext {
  runId: string
  /** Where the Step reads its inputs and writes its outputs. */
  runFolder: string
  /** Redo work whose output already exists. */
  force: boolean
}

/** The exit code of a Step that skipped itself, such as one whose configuration isn't there yet (sysexits' EX_CONFIG). */
export const skippedExitCode = 78

/** Thrown by a Step that has nothing it can do in this Run, so it is recorded as skipped, not failed. */
export class StepSkipped extends Error {}

/**
 * The Step contract: a standalone command that takes `--run <id>` (and `--force`), reads and
 * writes only the Run folder and state, and signals how it ended only through its exit code:
 * zero on success, `skippedExitCode` when it skipped itself, and any other on failure.
 */
export async function runAsStep(body: (ctx: StepContext) => Promise<void> | void): Promise<void> {
  try {
    const { values } = parseArgs({ options: { run: { type: 'string' }, force: { type: 'boolean', default: false } } })
    if (!values.run) throw new Error('Missing --run <id>')
    const runFolder = runDir(values.run)
    if (!existsSync(runFolder)) throw new Error(`No Run folder at ${runFolder}`)
    await body({ runId: values.run, runFolder, force: values.force })
  } catch (error) {
    if (error instanceof StepSkipped) {
      console.log(`Skipped: ${error.message}`)
      process.exitCode = skippedExitCode
      return
    }
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
