import type { Agent } from './agent.ts'
import { schemaErrors } from './schema.ts'
import { fakeWorker } from './workers/fake.ts'

/** What a Step passes to an Agent call, by the input names the Agent's config declares. */
export type Inputs = Record<string, unknown>

/** A coding-agent CLI that runs Agents, or the fake that stands in for one. */
export interface Worker {
  name: string
  /** Calls the Agent with these inputs, running it in `cwd`, and returns its answer. */
  call(agent: Agent, inputs: Inputs, options: { cwd: string }): Promise<unknown>
}

/**
 * Calls an Agent on its Worker, or on the fake Worker in a dry run, and returns its answer. Throws
 * when the inputs aren't exactly those the Agent's config declares, or when the answer doesn't
 * match its output schema.
 */
export async function callAgent(agent: Agent, inputs: Inputs, { cwd, dryRun }: { cwd: string; dryRun: boolean }): Promise<unknown> {
  const declared = Object.keys(agent.config.inputs)
  const missing = declared.filter((name) => !(name in inputs))
  const undeclared = Object.keys(inputs).filter((name) => !declared.includes(name))
  if (missing.length) throw new Error(`The ${agent.name} Agent was called without its ${missing.join(', ')} input`)
  if (undeclared.length) throw new Error(`The ${agent.name} Agent was given inputs its config doesn't declare: ${undeclared.join(', ')}`)
  if (!dryRun) throw new Error(`The ${agent.config.worker.name} Worker isn't built yet; start the Run with --dry-run`)
  const answer = await fakeWorker.call(agent, inputs, { cwd })
  const errors = agent.config.outputSchema ? schemaErrors(answer, agent.config.outputSchema) : []
  if (errors.length) throw new Error(`The ${agent.name} Agent's answer doesn't match its output schema: ${errors.join('; ')}`)
  return answer
}
