import type { Agent, Effort, WorkerChoice, WorkerName } from './agent.ts'
import { schemaErrors } from './schema.ts'
import { antigravityWorker } from './workers/antigravity.ts'
import { claudeCodeWorker } from './workers/claude-code.ts'
import { codexWorker } from './workers/codex.ts'
import { fakeWorker } from './workers/fake.ts'

/** What a Step passes to an Agent call, by the input names the Agent's config declares. */
export type Inputs = Record<string, unknown>

/** Where an Agent call runs, and the model and reasoning effort it asks the Worker for. */
export interface CallOptions {
  cwd: string
  model: string
  effort: Effort
}

/** A coding-agent CLI that runs Agents, or the fake that stands in for one. */
export interface Worker {
  name: string
  /** Calls the Agent with these inputs and returns its answer. */
  call(agent: Agent, inputs: Inputs, options: CallOptions): Promise<unknown>
}

const workers: Record<WorkerName, Worker> = { codex: codexWorker, 'claude-code': claudeCodeWorker, antigravity: antigravityWorker }

/** The Worker a call tries first, then its fallback. `override` swaps in the Agent's other Worker when that is the one named. */
export function attemptOrder(agent: Agent, override?: WorkerName): [WorkerChoice, WorkerChoice] {
  const { worker: main, fallbackWorker: fallback } = agent.config
  if (override === undefined || override === main.name) return [main, fallback]
  if (override === fallback.name) return [fallback, main]
  throw new Error(`The ${agent.name} Agent isn't set up to run on ${override}`)
}

/**
 * Calls an Agent on its Worker, or on the fake Worker in a dry run, and returns its answer. A call
 * that fails, times out, hits a quota limit or answers in the wrong shape is retried once on the
 * Agent's fallback Worker, and `log` gets a line for each attempt. `worker` runs it on that Worker
 * instead, when the Agent names it. Throws when the inputs aren't exactly those the Agent's config
 * declares, or when both attempts fail.
 */
export async function callAgent(
  agent: Agent,
  inputs: Inputs,
  { cwd, dryRun, worker, log = console.log }: { cwd: string; dryRun: boolean; worker?: WorkerName; log?: (line: string) => void },
): Promise<unknown> {
  const declared = Object.keys(agent.config.inputs)
  const missing = declared.filter((name) => !(name in inputs))
  const undeclared = Object.keys(inputs).filter((name) => !declared.includes(name))
  if (missing.length) throw new Error(`The ${agent.name} Agent was called without its ${missing.join(', ')} input`)
  if (undeclared.length) throw new Error(`The ${agent.name} Agent was given inputs its config doesn't declare: ${undeclared.join(', ')}`)
  const [main, fallback] = attemptOrder(agent, worker)
  if (dryRun) return checkedAnswer(agent, await fakeWorker.call(agent, inputs, { cwd, model: main.model, effort: main.effort }))

  const attempt = async (choice: WorkerChoice) => {
    const started = Date.now()
    const took = () => `${Math.round((Date.now() - started) / 1000)}s`
    try {
      const answer = checkedAnswer(agent, await workers[choice.name].call(agent, inputs, { cwd, model: choice.model, effort: choice.effort }))
      log(`${agent.name} answered on ${described(choice)} in ${took()}`)
      return answer
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log(`${agent.name} failed on ${described(choice)} after ${took()}: ${message}${choice === main ? `; retrying once on ${described(fallback)}` : ''}`)
      throw new Error(`${choice.name} failed: ${message}`)
    }
  }
  try {
    return await attempt(main)
  } catch (first) {
    try {
      return await attempt(fallback)
    } catch (second) {
      throw new Error(`${(first as Error).message}; then ${(second as Error).message}`)
    }
  }
}

/** The answer, once it matches the Agent's output schema. */
function checkedAnswer(agent: Agent, answer: unknown): unknown {
  const errors = agent.config.outputSchema ? schemaErrors(answer, agent.config.outputSchema) : []
  if (errors.length) throw new Error(`The ${agent.name} Agent's answer doesn't match its output schema: ${errors.join('; ')}`)
  return answer
}

const described = ({ name, model, effort }: WorkerChoice) => `${name} (${model}, ${effort})`
