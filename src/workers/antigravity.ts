// The Antigravity Worker: runs an Agent through `agy --print`, Antigravity's headless mode, in its
// sandbox, and reads the answer from its JSON result. Its rules and tools can only come from files,
// so it runs on the Pipeline's own Antigravity home, never Saransh's, and each call writes the
// Agent's permissions and a custom agent for it there. Antigravity runs only as a fallback Worker
// until its headless bugs are fixed, and the Agent's skills go in the prompt.
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { undeclaredTools, type Agent } from '../agent.ts'
import { runGit } from '../git.ts'
import { antigravityHomeDir } from '../paths.ts'
import type { ProcessResult } from '../process.ts'
import type { CallOptions, Inputs, Worker } from '../worker.ts'
import { agentPrompt, jsonResult, runCommandLine, writeFolders, type CommandLine } from './cli.ts'

interface AntigravityOptions extends CallOptions {
  /** The Pipeline's own Antigravity home, which Saransh logs in to once. */
  home: string
}

/** Antigravity's allow and deny rules, as its settings file holds them. Deny wins over allow. */
interface Permissions {
  allow: string[]
  deny: string[]
}

/**
 * What the Agent is told about Antigravity's sandbox. Antigravity ends a call at the first thing it
 * refuses, so the Agent is told not to ask for more.
 */
const limits =
  "Your commands run in a sandbox with no network, which reads only the folder you run in, its git data, your Tools and your skills, and writes only the folders you may write. Work within it: never ask to run a command outside the sandbox, or to read or write a file it doesn't give you. Antigravity refuses, and a refusal ends your call."

/** Whether `agent` may write any folder. */
const writes = (agent: Agent) => agent.config.permissions !== 'read-only' && agent.config.permissions.write.length > 0

/**
 * The custom agent each call of `agent` runs as, by its name and the file that defines it. It has
 * only the tools to read files, run commands, write files when the Agent may, and finish, so none
 * of Antigravity's other tools, such as web search, and it takes on no skills, rules, plugins,
 * subagents or MCP servers, neither Antigravity's own nor the Repo's.
 */
export function antigravityCustomAgent(agent: Agent): { name: string; definition: string } {
  const name = `pipeline-${agent.name}`
  const tools = ['read_file', 'run_command', ...(writes(agent) ? ['write_file', 'edit_file'] : []), 'finish']
  return {
    name,
    definition: `---\nname: ${name}\ndescription: The ${agent.name} Agent of Saransh's Pipeline.\ntools: [${tools.join(', ')}]\ninheritCustomizations: false\n---\n\nFollow the prompt.\n`,
  }
}

/**
 * The `agy --print` command line for one call of `agent`, with the prompt in --print, since print
 * mode doesn't read it from stdin.
 */
export function antigravityCommandLine(agent: Agent, inputs: Inputs, { model, effort, home }: AntigravityOptions): CommandLine {
  const { outputSchema, timeoutSeconds } = agent.config
  return {
    command: 'agy',
    args: [
      '--output-format',
      'json',
      ...(outputSchema ? ['--json-schema', JSON.stringify(outputSchema)] : []),
      '--model',
      model,
      '--effort',
      effort,
      '--agent',
      antigravityCustomAgent(agent).name,
      '--sandbox',
      // Text in the inputs, such as a commit subject, can't start a slash command or a skill.
      '--disable-slash-commands',
      `--print=${agentPrompt(agent, inputs, { inlineSkills: true, limits })}`,
    ],
    stdin: '',
    // Saransh's own Antigravity config, plugins and skills stay out of the call, and an environment
    // variable can't switch it to other credentials.
    env: { HOME: home, AGY_ADC_AUTH: undefined },
    timeoutSeconds,
  }
}

/**
 * The rules for one call of `agent`. Its sandbox reads only the folder the call runs in and what
 * these allow: the git data of that folder, which a worktree keeps in its clone, the Agent's Tools
 * and its skills. It writes only the Agent's write folders, or nothing when the Agent is
 * read-only. It can't read or run another Tool, or reach the network or an MCP server. No rule
 * allows a command, since a command a rule allows may also run outside the sandbox.
 */
export function antigravityPermissions(agent: Agent, { cwd, gitDir, undeclaredTools }: { cwd: string; gitDir?: string; undeclaredTools: string[] }): Permissions {
  return {
    allow: [
      ...(gitDir ? [`read_file(${gitDir})`] : []),
      ...agent.tools.map((tool) => `read_file(${tool.path})`),
      ...agent.skills.map((skill) => `read_file(${skill.folder})`),
      ...writeFolders(agent, cwd).map((folder) => `write_file(${folder})`),
    ],
    deny: [...undeclaredTools.map((tool) => `read_file(${tool})`), ...(writes(agent) ? [] : ['write_file(*)']), 'read_url(*)', 'execute_url(*)', 'mcp(*)'],
  }
}

/**
 * The rules of each call running now. Calls of one Agent run at once, such as reviews of several
 * Repos, and Antigravity rereads the one settings file during a call, so it holds all of their rules.
 */
const rulesOfRunningCalls = new Set<Permissions>()

export const antigravityWorker: Worker = {
  name: 'antigravity',
  async call(agent, inputs, { cwd, model, effort }) {
    const home = antigravityHomeDir()
    const gitDir = await runGit(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']).then(
      (dir) => dir.trim(),
      () => undefined,
    )
    const permissions = antigravityPermissions(agent, { cwd, gitDir, undeclaredTools: undeclaredTools(agent) })
    rulesOfRunningCalls.add(permissions)
    try {
      const { name, definition } = antigravityCustomAgent(agent)
      writeWhole(join(home, '.gemini', 'config', 'agents', `${name}.md`), definition)
      const all = (kind: keyof Permissions) => [...new Set([...rulesOfRunningCalls].flatMap((rules) => rules[kind]))]
      writeSettings(home, { allow: all('allow'), deny: all('deny') })
      return antigravityAnswer(agent, home, await runCommandLine(antigravityCommandLine(agent, inputs, { cwd, model, effort, home }), cwd))
    } finally {
      rulesOfRunningCalls.delete(permissions)
    }
  },
}

/**
 * Puts `permissions` in the settings file in Antigravity's home, replacing any there and keeping
 * its other settings. Commands run in the sandbox without asking, and it asks before running one
 * outside, which print mode refuses.
 */
function writeSettings(home: string, permissions: Permissions) {
  const file = join(home, '.gemini', 'antigravity-cli', 'settings.json')
  let settings: object = {}
  try {
    settings = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`Can't read Antigravity's settings in ${file}: ${(error as Error).message}`)
  }
  writeWhole(file, JSON.stringify({ ...settings, toolPermission: 'proceed-in-sandbox', permissions }, null, 2))
}

/** Writes `file` whole and then moves it into place, since calls already running reread it. */
function writeWhole(file: string, text: string) {
  mkdirSync(dirname(file), { recursive: true })
  const written = `${file}.${randomUUID()}`
  writeFileSync(written, text)
  renameSync(written, file)
}

/** The JSON result `agy --print --output-format json` prints, as far as reading its answer needs. */
interface AntigravityResult {
  status: string
  response?: string
  /** Set only when the call failed. */
  error?: string
  /** The answer checked against --json-schema. */
  structured_output?: unknown
  /** What it asked for and was refused. */
  denied_actions?: { action: string }[]
}

/** Antigravity's answer: the schema-checked one when the Agent has an output schema. Throws Antigravity's own error when the call failed. */
function antigravityAnswer(agent: Agent, home: string, ended: ProcessResult): unknown {
  const { code } = ended
  const result = jsonResult<AntigravityResult>('agy', ended)
  if (result.status !== 'SUCCESS' || code !== 0) {
    const failure = result.error || result.status
    throw new Error(/authentication/i.test(failure) ? `${failure}; log in once with HOME=${home} agy` : failure)
  }
  const answer = agent.config.outputSchema ? withoutFinishFields(agent, result.structured_output) : withoutFinishLine(result.response)
  if (answer !== undefined) return answer
  // It ends a call at the first thing it refuses, and still reports success.
  const refused = result.denied_actions?.map((denied) => denied.action) ?? []
  if (refused.length) throw new Error(`it stopped when it was refused ${refused.join(', ')}`)
  throw new Error(agent.config.outputSchema ? 'agy finished without a schema-checked answer' : 'agy finished without an answer')
}

/**
 * The fields of a custom agent's finish tool, which Antigravity puts in the answer, both in its
 * schema-checked one and as a line of JSON before its text.
 */
const finishFields = ['toolAction', 'toolSummary']

/** The schema-checked answer without the finish tool's fields, unless the Agent's schema asks for them. */
function withoutFinishFields(agent: Agent, answer: unknown): unknown {
  if (typeof answer !== 'object' || answer === null || Array.isArray(answer)) return answer
  const declared = Object.keys(agent.config.outputSchema?.properties ?? {})
  return Object.fromEntries(Object.entries(answer).filter(([field]) => declared.includes(field) || !finishFields.includes(field)))
}

/** The answer's text without the line of the finish tool's fields before it; none when it is empty. */
function withoutFinishLine(response: string | undefined): string | undefined {
  const [first, ...rest] = (response ?? '').split('\n')
  let finishLine = false
  try {
    const fields = JSON.parse(first)
    finishLine = typeof fields === 'object' && fields !== null && Object.keys(fields).length > 0 && Object.keys(fields).every((field) => finishFields.includes(field))
  } catch {}
  return (finishLine ? rest.join('\n') : response)?.trim() || undefined
}
