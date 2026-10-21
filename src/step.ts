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

/**
 * The Step contract: a standalone command that takes `--run <id>` (and `--force`), reads and
 * writes only the Run folder and state, and signals failure only through a non-zero exit code.
 */
export async function runAsStep(body: (ctx: StepContext) => Promise<void> | void): Promise<void> {
  try {
    const { values } = parseArgs({ options: { run: { type: 'string' }, force: { type: 'boolean', default: false } } })
    if (!values.run) throw new Error('Missing --run <id>')
    const runFolder = runDir(values.run)
    if (!existsSync(runFolder)) throw new Error(`No Run folder at ${runFolder}`)
    await body({ runId: values.run, runFolder, force: values.force })
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
