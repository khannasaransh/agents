import type { Agent, Effort, WorkerChoice, WorkerName } from './agent.ts'
import { adversaryEnabled } from './env.ts'
import type { TokenUsage } from './token-usage.ts'
import { comparisonAgent, independentAgent, type AdversaryResult, type ContestedPoint, type MissedItem } from './adversary.ts'
import { schemaErrors } from './schema.ts'
import { antigravityWorker } from './workers/antigravity.ts'
import { claudeCodeWorker } from './workers/claude-code.ts'
import { codexWorker } from './workers/codex.ts'
import { cursorWorker } from './workers/cursor.ts'
import { fakeWorker } from './workers/fake.ts'

/** What a Step passes to an Agent call, by the input names the Agent's config declares. */
export type Inputs = Record<string, unknown>

/** Where an Agent call runs, and the model and reasoning effort it asks the Worker for. */
export interface CallOptions {
  cwd: string
  model: string
  effort: Effort
  /** Usage reported by the CLI, including failed calls when available. */
  onUsage?: (usage: TokenUsage) => void
}

/** A coding-agent CLI that runs Agents, or the fake that stands in for one. */
export interface Worker {
  name: string
  /** Calls the Agent with these inputs and returns its answer. */
  call(agent: Agent, inputs: Inputs, options: CallOptions): Promise<unknown>
}

const workers: Record<WorkerName, Worker> = { codex: codexWorker, 'claude-code': claudeCodeWorker, antigravity: antigravityWorker, cursor: cursorWorker }

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
  { cwd, dryRun, worker, log = console.log, onAdversary }: { cwd: string; dryRun: boolean; worker?: WorkerName; log?: (line: string) => void; onAdversary?: (result: AdversaryResult) => void },
): Promise<unknown> {
  const declared = Object.keys(agent.config.inputs)
  const missing = declared.filter((name) => !(name in inputs))
  const undeclared = Object.keys(inputs).filter((name) => !declared.includes(name))
  if (missing.length) throw new Error(`The ${agent.name} Agent was called without its ${missing.join(', ')} input`)
  if (undeclared.length) throw new Error(`The ${agent.name} Agent was given inputs its config doesn't declare: ${undeclared.join(', ')}`)
  const [main, fallback] = attemptOrder(agent, worker)
  const adversary = adversaryEnabled() ? agent.config.adversaryWorker : undefined
  if (agent.config.adversaryWorker && !adversary) log(`${agent.name}: adversary off (ADVERSARY=false)`)
  // Check the effective order too: callers may construct Agents without loadAgent, and either
  // attempt can provide the main answer. An override must never collapse the two roles.
  if (adversary && [main.name, fallback.name].includes(adversary.name))
    throw new Error(`The ${agent.name} Agent's adversaryWorker must differ from both main and fallback Workers`)
  const attempt = async (choice: WorkerChoice, target = agent, given = inputs, retry = false) => {
    let usage: TokenUsage | null = null
    const usageSuffix = () => usage ? ` [tokens=${JSON.stringify(usage)}]` : ''
    const started = Date.now()
    const took = () => `${Math.round((Date.now() - started) / 1000)}s`
    try {
      const answer = checkedAnswer(target, await (dryRun ? fakeWorker : workers[choice.name]).call(target, given, { cwd, model: choice.model, effort: choice.effort, onUsage: reported => { usage = reported } }))
      log(`${target.name} answered on ${dryRun ? 'fake for ' : ''}${described(choice)} in ${took()}${usageSuffix()}`)
      return answer
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log(`${target.name} failed on ${dryRun ? 'fake for ' : ''}${described(choice)} after ${took()}: ${message.replace(/\r?\n/g, '\\n')}${retry ? `; retrying once on ${described(fallback)}` : ''}${usageSuffix()}`)
      if (dryRun) throw error
      throw new Error(`${choice.name} failed: ${message}`)
    }
  }
  // Finish independent work before the main call can edit its working directory. Neither answer
  // is given to the other until comparison; only the main answer is returned to the Step.
  let independentAnswer: unknown
  let adversaryError: string | undefined
  if (adversary) {
    try { independentAnswer = await attempt(adversary, independentAgent(agent)) }
    catch (error) { adversaryError = (error as Error).message }
  }
  let answer: unknown
  let answeredOn = main
  try {
    answer = await attempt(main, agent, inputs, !dryRun)
  } catch (first) {
    if (dryRun) throw first
    try {
      answer = await attempt(fallback)
      answeredOn = fallback
    } catch (second) {
      throw new Error(`${(first as Error).message}; then ${(second as Error).message}`)
    }
  }
  if (adversary) {
    let result: AdversaryResult
    const about = { agent: agent.name, mainWorker: answeredOn, worker: adversary, ...(independentAnswer !== undefined && { independentAnswer }) }
    try {
      if (adversaryError) throw new Error(adversaryError)
      const compared = await attempt(adversary, comparisonAgent(agent), { task: inputs, mainAnswer: answer, independentAnswer }) as { points: ContestedPoint[]; missed: MissedItem[] }
      for (const point of compared.points) {
        if (![point.topic, point.main, point.adversary, point.resolution].every(text => text.trim()) || !point.evidence.length || point.evidence.some(text => !text.trim()))
          throw new Error('Each contested point must include both positions, concrete evidence and a resolution')
      }
      for (const item of compared.missed) {
        if (![item.topic, item.item].every(text => text.trim()) || !item.evidence.length || item.evidence.some(text => !text.trim()))
          throw new Error('Each missed item must say what was left out and cite concrete evidence')
      }
      result = { ...about, status: 'compared', points: compared.points, missed: compared.missed }
    } catch (error) {
      result = { ...about, status: 'failed', error: (error as Error).message }
      log(`${agent.name}: adversarial assessment unavailable: ${result.error.replace(/\r?\n/g, '\\n')}`)
    }
    onAdversary?.(result)
  }
  return answer
}

/** The answer, once it matches the Agent's output schema. */
function checkedAnswer(agent: Agent, answer: unknown): unknown {
  const errors = agent.config.outputSchema ? schemaErrors(answer, agent.config.outputSchema) : []
  if (errors.length) throw new Error(`The ${agent.name} Agent's answer doesn't match its output schema: ${errors.join('; ')}`)
  return answer
}

const described = ({ name, model, effort }: WorkerChoice) => `${name} (${model}, ${effort})`
