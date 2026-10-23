import { accessSync, constants, existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { agentsDir } from './paths.ts'
import { schemaErrors, type JsonSchema } from './schema.ts'

export const workerNames = ['codex', 'claude-code', 'antigravity'] as const
export type WorkerName = (typeof workerNames)[number]

const efforts = ['low', 'medium', 'high'] as const
export type Effort = (typeof efforts)[number]

/** A Worker to run an Agent on, with the model and reasoning effort to ask it for. */
export interface WorkerChoice {
  name: WorkerName
  model: string
  effort: Effort
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
  /** The Tools the Agent may run, by their file names in its tools folder, with how to run each and what it does. */
  tools?: Record<string, string>
  /** When set, the Agent's answer must match it. */
  outputSchema?: JsonSchema
  /**
   * What Save state does with the Memory the Agent proposes: apply it straight away (the default),
   * or queue it for Saransh to accept or reject with `agents memory`.
   */
  memoryChanges?: 'apply' | 'review'
  timeoutSeconds: number
  maxTurns: number
}

/** A command an Agent owns, in its tools folder, that its Worker may run during a call. */
export interface Tool {
  name: string
  /** Its full path, which is how the Worker runs it. */
  path: string
  /** How to run it and what it does, as the Agent's config declares. */
  usage: string
}

/** Instructions an Agent's Worker follows when a task calls for them: a folder in the Agent's skills folder, holding a SKILL.md. */
export interface Skill {
  name: string
  folder: string
  /** Its SKILL.md. */
  text: string
}

/** An Agent: a folder holding its config module, instructions file, Tools and skills. */
export interface Agent {
  name: string
  folder: string
  config: AgentConfig
  instructions: string
  /** The Tools its config declares. */
  tools: Tool[]
  /** Every skill in its skills folder. */
  skills: Skill[]
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
    tools: { type: 'object', additionalProperties: { type: 'string' } },
    outputSchema: { type: 'object' },
    memoryChanges: { enum: ['apply', 'review'] },
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
  if (!errors.length && config.worker.name === 'antigravity')
    errors.push("config.worker can't be antigravity, which runs only as a fallbackWorker until its headless bugs are fixed")
  if (errors.length) throw new Error(`Invalid config for the ${name} Agent in ${configFile}: ${errors.join('; ')}`)

  return { name, folder, config, instructions: readFileSync(instructionsFile, 'utf8'), tools: declaredTools(name, folder, config), skills: skillsIn(name, folder) }
}

/** The Tools `config` declares, each checked to be a command in the Agent's tools folder. */
function declaredTools(name: string, folder: string, config: AgentConfig): Tool[] {
  return Object.entries(config.tools ?? {}).map(([tool, usage]) => {
    const path = join(folder, 'tools', tool)
    if (basename(tool) !== tool) throw new Error(`The ${name} Agent's config declares the Tool ${tool}, which isn't a file name in its tools folder`)
    if (!existsSync(path)) throw new Error(`The ${name} Agent's config declares the Tool ${tool}, but there is no ${path}`)
    try {
      accessSync(path, constants.X_OK)
    } catch {
      throw new Error(`The ${name} Agent's Tool ${path} isn't executable`)
    }
    return { name: tool, path, usage }
  })
}

/**
 * The skills in the Agent's skills folder. A skill can't allow itself commands, since the Agent's
 * config declares every Tool it may run.
 */
function skillsIn(name: string, folder: string): Skill[] {
  return pathsIn(join(folder, 'skills'))
    .filter((skillFolder) => statSync(skillFolder).isDirectory())
    .map((skillFolder) => {
      const skill = basename(skillFolder)
      const file = join(skillFolder, 'SKILL.md')
      if (!existsSync(file)) throw new Error(`The ${name} Agent's skill ${skill} has no SKILL.md in ${skillFolder}`)
      const text = readFileSync(file, 'utf8')
      // Line endings, a byte order mark or a quoted key mustn't hide the setting from this check.
      const frontmatter = /^---\n([\s\S]*?)\n---/.exec(text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'))?.[1] ?? ''
      if (/allowed-tools/i.test(frontmatter))
        throw new Error(`The ${name} Agent's skill ${skill} sets allowed-tools in ${file}; declare the Tools it needs in the Agent's config instead`)
      return { name: skill, folder: skillFolder, text }
    })
}

/** Every Tool in the Agents folder that `agent` doesn't declare: its own undeclared ones and every other Agent's. */
export function undeclaredTools(agent: Agent): string[] {
  const declared = new Set(agent.tools.map((tool) => tool.path))
  return pathsIn(agentsDir())
    .flatMap((other) => pathsIn(join(other, 'tools')))
    .filter((path) => statSync(path).isFile() && !declared.has(path))
    .sort()
}

/** What a folder holds, by full path; nothing when there is no such folder. */
function pathsIn(folder: string): string[] {
  try {
    return readdirSync(folder).map((entry) => join(folder, entry))
  } catch {
    return []
  }
}
