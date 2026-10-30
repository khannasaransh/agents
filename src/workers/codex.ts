// The Codex Worker: runs an Agent through `codex exec`, Codex's non-interactive mode, in its
// sandbox, and reads the answer from its JSON event stream. Codex can't load skills from outside the
// folders it searches, so the Agent's skills go in the prompt.
import { readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { undeclaredTools, type Agent } from '../agent.ts'
import { workerTokenUsage } from '../token-usage.ts'
import type { ProcessResult } from '../process.ts'
import type { CallOptions, Inputs, Worker } from '../worker.ts'
import { agentPrompt, lastLine, runCommandLine, withTempFolder, writeFolders, type CommandLine } from './cli.ts'

interface CodexOptions extends CallOptions {
  /** Where the Agent's output schema is written for Codex to check its final answer against. */
  schemaFile: string
  /** The Tools the Agent doesn't declare, which Codex can't read or run. */
  undeclaredTools: string[]
  /** Every SKILL.md Codex would find by itself, all of them turned off. */
  foundSkills: string[]
}

/**
 * Codex features that give the model tools beyond reading, searching, running commands and editing
 * files, such as ChatGPT apps that act on Saransh's account, browsing and image generation.
 */
const extraToolFeatures = ['apps', 'plugins', 'browser_use', 'computer_use', 'image_generation', 'goals', 'tool_suggest']

/** A path in Codex's sandbox, and what the Agent may do with it. */
type SandboxRule = [path: string, access: 'write' | 'deny']

/** The `codex exec` command line for one call of `agent`, with the prompt on stdin. */
export function codexCommandLine(agent: Agent, inputs: Inputs, { cwd, model, effort, schemaFile, undeclaredTools, foundSkills }: CodexOptions): CommandLine {
  const { outputSchema, timeoutSeconds } = agent.config
  const sandboxRules = [
    ...writeFolders(agent, cwd).map((folder): SandboxRule => [folder, 'write']),
    ...undeclaredTools.map((tool): SandboxRule => [tool, 'deny']),
  ]
  return {
    command: 'codex',
    args: [
      'exec',
      // Only what this command line asks for: no MCP servers, plugins or notify hook from Saransh's
      // Codex config, no command rules from his or the Repo's, and none of Codex's extra tools.
      '--ignore-user-config',
      '--ignore-rules',
      ...extraToolFeatures.flatMap((feature) => ['--disable', feature]),
      // Web search only for an Agent whose config allows it.
      '--config',
      `web_search="${agent.config.webSearch ? 'live' : 'disabled'}"`,
      '--model',
      model,
      '--config',
      `model_reasoning_effort="${effort}"`,
      // Its sandbox reads everywhere, writes only the Agent's write folders (not even the folder it
      // runs in), has no network, and can't read or run a Tool the Agent doesn't declare.
      '--config',
      'default_permissions="agent"',
      '--config',
      `permissions.agent={extends=":read-only",filesystem={${sandboxRules.map(([path, access]) => `${JSON.stringify(path)}="${access}"`).join(',')}}}`,
      // On Windows that sandbox is a restricted token, which needs no setup on the machine. Without
      // it, Codex there has no sandbox and refuses every command, even one that only reads, yet can
      // still answer. A restricted token can't enforce a deny rule, so a call that denies a Tool
      // fails at once instead, and the Agent falls back to its other Worker. Other platforms ignore
      // the setting.
      '--config',
      'windows.sandbox="unelevated"',
      // The Agent's skills are in the prompt, so every skill Codex would find by itself is turned off.
      ...(foundSkills.length ? ['--config', `skills.config=[${foundSkills.map((file) => `{path=${JSON.stringify(file)},enabled=false}`).join(',')}]`] : []),
      '--cd',
      cwd,
      // An Agent with no Repo to read, such as the PM, runs in its Run folder, which isn't a git repo.
      '--skip-git-repo-check',
      '--json',
      ...(outputSchema ? ['--output-schema', schemaFile] : []),
      '-',
    ],
    stdin: agentPrompt(agent, inputs, { inlineSkills: true }),
    env: {},
    timeoutSeconds,
  }
}

/**
 * Every SKILL.md Codex would find by itself: its own bundled skills, Saransh's, the machine's, and
 * any in the folders from `cwd` up.
 */
function skillsCodexFinds(cwd: string): string[] {
  const codexHome = process.env.CODEX_HOME ?? join(homedir(), '.codex')
  const above = (folder: string): string[] => (dirname(folder) === folder ? [folder] : [folder, ...above(dirname(folder))])
  const roots = [join(codexHome, 'skills'), join(homedir(), '.agents', 'skills'), '/etc/codex/skills', ...above(cwd).map((folder) => join(folder, '.agents', 'skills'))]
  const skillFiles = (path: string): string[] => {
    if (basename(path) === 'SKILL.md') return [path]
    try {
      return readdirSync(path).flatMap((entry) => skillFiles(join(path, entry)))
    } catch {
      return []
    }
  }
  return roots.flatMap(skillFiles)
}

export const codexWorker: Worker = {
  name: 'codex',
  call(agent, inputs, { cwd, model, effort, onUsage }) {
    return withTempFolder('agents-codex-', async (temp) => {
      const schemaFile = join(temp, 'output-schema.json')
      if (agent.config.outputSchema) writeFileSync(schemaFile, JSON.stringify(agent.config.outputSchema))
      const line = codexCommandLine(agent, inputs, { cwd, model, effort, schemaFile, undeclaredTools: undeclaredTools(agent), foundSkills: skillsCodexFinds(cwd) })
      return codexAnswer(agent, await runCommandLine(line, cwd, result => {
        const usage = workerTokenUsage('codex', result.stdout, result.timedOut)
        if (usage) onUsage?.(usage)
      }))
    })
  },
}

/** The events `codex exec --json` prints, one per line, as far as reading its answer needs. */
interface CodexEvent {
  type: string
  message?: string
  error?: { message?: string }
  item?: { type: string; text?: string }
}

/** Codex's final answer, parsed when the Agent has an output schema. Throws Codex's own error when the call failed. */
function codexAnswer(agent: Agent, { code, stdout, stderr }: ProcessResult): unknown {
  const events = stdout.split('\n').flatMap((line): CodexEvent[] => {
    try {
      return [JSON.parse(line)]
    } catch {
      return []
    }
  })
  // Codex also reports errors it recovers from, such as reconnecting, so only a failed turn or exit counts.
  const failedTurn = events.findLast((e) => e.type === 'turn.failed')
  if (failedTurn || code !== 0) {
    const failure = failedTurn?.error?.message ?? events.findLast((e) => e.type === 'error')?.message
    throw new Error(failure !== undefined ? apiMessage(failure) : lastLine(stderr) || `codex exited with ${code}`)
  }
  const answer = events.findLast((e) => e.type === 'item.completed' && e.item?.type === 'agent_message')?.item?.text
  if (answer === undefined) throw new Error('codex finished without an answer')
  if (!agent.config.outputSchema) return answer
  try {
    return JSON.parse(answer)
  } catch {
    throw new Error(`codex answered with something that isn't JSON: ${answer.slice(0, 200)}`)
  }
}

/** Codex passes an API error on as the API's JSON error body; this is the message inside it. */
function apiMessage(failure: string): string {
  try {
    return JSON.parse(failure).error?.message ?? failure
  } catch {
    return failure
  }
}
