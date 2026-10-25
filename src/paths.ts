import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The root folder of this agents repo (not a Repo the Pipeline watches). */
export const agentsRoot = fileURLToPath(new URL('..', import.meta.url))

/** The Agent folders, one per Agent. */
export function agentsDir(): string {
  return process.env.AGENTS_AGENTS_DIR ?? join(agentsRoot, 'agents')
}

/** The Workers' config that setup installs, a folder per Worker laid out as in the home folder. */
export function workerConfigDir(): string {
  return process.env.AGENTS_WORKER_CONFIG_DIR ?? join(agentsRoot, 'worker-config')
}

/** The git-ignored data area: Runs, state, Memory, the PRD inbox and the Broker inbox. */
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

/** Every Agent's Memory, a folder per Agent. Saransh may edit it by hand; nothing deletes it. */
export function memoryDir(): string {
  return join(dataDir(), 'memory')
}

/** Where PRD files wait for the Docs Agent, whether the Discord Step saved them or Saransh dropped them in by hand. */
export function prdInboxDir(): string {
  return join(dataDir(), 'prd-inbox')
}

/** Where Saransh drops his brokers' tradebooks and holdings exports, and may drop Answers files too. */
export function brokerInboxDir(): string {
  return join(dataDir(), 'broker-inbox')
}

/** Saransh's Downloads folder, where the Stocks Brief's Save answers button saves an Answers file. */
export function downloadsDir(): string {
  return join(homedir(), 'Downloads')
}

/** The Pipeline's own Antigravity home, which Saransh logs in to once, so his own Antigravity config stays out of its calls. */
export function antigravityHomeDir(): string {
  return join(dataDir(), 'antigravity-home')
}

/** Where Agents get temporary worktrees of the Repos they work on. */
export function worktreesDir(): string {
  return join(dataDir(), 'worktrees')
}
