import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { agentsDir } from './paths.ts'
import { schemaErrors, type JsonSchema } from './schema.ts'

export const workerNames = ['codex', 'claude-code', 'antigravity'] as const
export type WorkerName = (typeof workerNames)[number]

const efforts = ['low', 'medium', 'high'] as const

/** A Worker to run an Agent on, with the model and reasoning effort to ask it for. */
export interface WorkerChoice {
  name: WorkerName
  model: string
  effort: (typeof efforts)[number]
}

/** An Agent's config module (config.ts in its folder) exports one of these as its default. */
export interface AgentConfig {
  worker: WorkerChoice
  /** Used when a call on `worker` fails, times out or hits a quota limit. */
  fallbackWorker: WorkerChoice
  /** Read-only, or the folders the Agent may write. */
  permissions: 'read-only' | { write: string[] }
  /** What the Step passes in, by name, with what each holds. */
  inputs: Record<string, string>
  /** What the Agent hands back, by name, with what each holds. */
  outputs: Record<string, string>
  /** When set, the Agent's answer must match it. */
  outputSchema?: JsonSchema
  timeoutSeconds: number
  maxTurns: number
}

/** An Agent: a folder holding its config module and instructions file. */
export interface Agent {
  name: string
  folder: string
  config: AgentConfig
  instructions: string
}

const workerChoiceSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'model', 'effort'],
  properties: { name: { enum: workerNames }, model: { type: 'string' }, effort: { enum: efforts } },
}

const configSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['worker', 'fallbackWorker', 'permissions', 'inputs', 'outputs', 'timeoutSeconds', 'maxTurns'],
  properties: {
    worker: workerChoiceSchema,
    fallbackWorker: workerChoiceSchema,
    permissions: {
      description: '"read-only" or { write: [folders] }',
      anyOf: [
        { enum: ['read-only'] },
        { type: 'object', additionalProperties: false, required: ['write'], properties: { write: { type: 'array', items: { type: 'string' } } } },
      ],
    },
    inputs: { type: 'object', additionalProperties: { type: 'string' } },
    outputs: { type: 'object', additionalProperties: { type: 'string' } },
    outputSchema: { type: 'object' },
    timeoutSeconds: { type: 'integer', minimum: 1 },
    maxTurns: { type: 'integer', minimum: 1 },
  },
}

/** Loads the named Agent's folder, failing with a message that says what is missing or invalid. */
export async function loadAgent(name: string): Promise<Agent> {
  const folder = join(agentsDir(), name)
  const configFile = join(folder, 'config.ts')
  const instructionsFile = join(folder, 'instructions.md')
  for (const file of [configFile, instructionsFile]) if (!existsSync(file)) throw new Error(`The ${name} Agent has no ${basename(file)} in ${folder}`)

  const config: AgentConfig = (await import(pathToFileURL(configFile).href)).default
  const errors = schemaErrors(config, configSchema, 'config')
  if (!errors.length && config.fallbackWorker.name === config.worker.name)
    errors.push('config.fallbackWorker must name a different Worker from config.worker')
  if (errors.length) throw new Error(`Invalid config for the ${name} Agent in ${configFile}: ${errors.join('; ')}`)

  return { name, folder, config, instructions: readFileSync(instructionsFile, 'utf8') }
}
