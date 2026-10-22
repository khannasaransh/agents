// The Codex Worker: runs an Agent through `codex exec`, Codex's non-interactive mode, in its
// sandbox, and reads the answer from its JSON event stream.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Agent } from '../agent.ts'
import type { ProcessResult } from '../process.ts'
import type { CallOptions, Inputs, Worker } from '../worker.ts'
import { agentPrompt, lastLine, runCommandLine, writeFolders, type CommandLine } from './cli.ts'

interface CodexOptions extends CallOptions {
  /** Where the Agent's output schema is written for Codex to check its final answer against. */
  schemaFile: string
}

/** The `codex exec` command line for one call of `agent`, with the prompt on stdin. */
export function codexCommandLine(agent: Agent, inputs: Inputs, { cwd, model, effort, schemaFile }: CodexOptions): CommandLine {
  const { outputSchema, timeoutSeconds } = agent.config
  const writable = writeFolders(agent, cwd)
  return {
    command: 'codex',
    args: [
      'exec',
      // Only what this command line asks for: no MCP servers, plugins or notify hook from Saransh's Codex config.
      '--ignore-user-config',
      '--model',
      model,
      '--config',
      `model_reasoning_effort="${effort}"`,
      // Codex's workspace-write sandbox always lets the Agent write the folder it runs in too, so a
      // write Agent runs in one of its write folders. The temporary folders it would open are closed.
      '--sandbox',
      ...(writable.length
        ? ['workspace-write', '--config', 'sandbox_workspace_write.exclude_slash_tmp=true', '--config', 'sandbox_workspace_write.exclude_tmpdir_env_var=true']
        : ['read-only']),
      ...writable.flatMap((folder) => ['--add-dir', folder]),
      '--cd',
      cwd,
      '--json',
      ...(outputSchema ? ['--output-schema', schemaFile] : []),
      '-',
    ],
    stdin: agentPrompt(agent, inputs),
    env: {},
    timeoutSeconds,
  }
}

export const codexWorker: Worker = {
  name: 'codex',
  async call(agent, inputs, { cwd, model, effort }) {
    const temp = mkdtempSync(join(tmpdir(), 'agents-codex-'))
    try {
      const schemaFile = join(temp, 'output-schema.json')
      if (agent.config.outputSchema) writeFileSync(schemaFile, JSON.stringify(agent.config.outputSchema))
      return codexAnswer(agent, await runCommandLine(codexCommandLine(agent, inputs, { cwd, model, effort, schemaFile }), cwd))
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
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
