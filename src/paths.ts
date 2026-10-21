import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The root folder of this agents repo (not a Repo the Pipeline watches). */
export const agentsRoot = fileURLToPath(new URL('..', import.meta.url))

/** The git-ignored data area: Runs, state, and later Memory and the PRD inbox. */
export function dataDir(): string {
  return process.env.AGENTS_DATA_DIR ?? join(agentsRoot, 'data')
}

export function runsDir(): string {
  return join(dataDir(), 'runs')
}

export function runDir(runId: string): string {
  return join(runsDir(), runId)
}

export function stateDir(): string {
  return join(dataDir(), 'state')
}
