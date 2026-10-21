import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The root folder of this agents repo (not a Repo the Pipeline watches). */
export const agentsRoot = fileURLToPath(new URL('..', import.meta.url))

/** The Agent folders, one per Agent. */
export function agentsDir(): string {
  return process.env.AGENTS_AGENTS_DIR ?? join(agentsRoot, 'agents')
}

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

/** Where Agents get temporary worktrees of the Repos they work on. */
export function worktreesDir(): string {
  return join(dataDir(), 'worktrees')
}
