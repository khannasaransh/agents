// The Claude Code Worker: runs an Agent through `claude --print`, Claude Code's headless mode, on
// Saransh's logged-in subscription, and reads the answer from its JSON result.
import type { Agent } from '../agent.ts'
import type { ProcessResult } from '../process.ts'
import type { CallOptions, Inputs, Worker } from '../worker.ts'
import { agentPrompt, lastLine, runCommandLine, writeFolders, type CommandLine } from './cli.ts'

/**
 * The `claude --print` command line for one call of `agent`, with the prompt on stdin. It never
 * uses --bare, which ignores Saransh's login.
 */
export function claudeCodeCommandLine(agent: Agent, inputs: Inputs, { cwd, model, effort }: CallOptions): CommandLine {
  const { outputSchema, maxTurns, timeoutSeconds } = agent.config
  const writable = writeFolders(agent, cwd)
  return {
    command: 'claude',
    args: [
      '--print',
      '--output-format',
      'json',
      ...(outputSchema ? ['--json-schema', JSON.stringify(outputSchema)] : []),
      '--model',
      model,
      '--effort',
      effort,
      '--max-turns',
      String(maxTurns),
      // No settings files (Saransh's, or any the Repo commits), so no hooks, plugins or allow rules
      // from them, and no MCP servers. File tools stay inside the folders the call may use.
      '--restricted',
      '--strict-mcp-config',
      // Anything not allowed here is denied without asking. Bash runs only the commands Claude Code
      // itself counts as read-only, such as git log and git diff.
      '--permission-mode',
      'dontAsk',
      '--tools',
      writable.length ? 'Read,Grep,Glob,Bash,Edit,Write' : 'Read,Grep,Glob,Bash',
      ...writable.flatMap((folder) => ['--add-dir', folder]),
      // An Edit rule covers every tool that writes files. `//` starts an absolute path.
      ...(writable.length ? ['--allowedTools', ...writable.map((folder) => `Edit(/${folder}/**)`)] : []),
    ],
    stdin: agentPrompt(agent, inputs),
    // A key or token in the environment would take precedence over Saransh's logged-in subscription.
    env: { ANTHROPIC_API_KEY: undefined, ANTHROPIC_AUTH_TOKEN: undefined },
    timeoutSeconds,
  }
}

export const claudeCodeWorker: Worker = {
  name: 'claude-code',
  async call(agent, inputs, options) {
    return claudeCodeAnswer(agent, await runCommandLine(claudeCodeCommandLine(agent, inputs, options), options.cwd))
  },
}

/** The JSON result `claude --print --output-format json` prints, as far as reading its answer needs. */
interface ClaudeCodeResult {
  subtype: string
  is_error: boolean
  result?: string
  /** The answer checked against --json-schema. */
  structured_output?: unknown
}

/** Claude Code's answer: the schema-checked one when the Agent has an output schema. Throws Claude Code's own error when the call failed. */
function claudeCodeAnswer(agent: Agent, { code, stdout, stderr }: ProcessResult): unknown {
  let result: ClaudeCodeResult
  try {
    result = JSON.parse(stdout)
  } catch {
    throw new Error(lastLine(stderr) || lastLine(stdout) || `claude exited with ${code}`)
  }
  if (result.is_error || result.subtype !== 'success' || code !== 0) {
    throw new Error(result.subtype === 'error_max_turns' ? `stopped at its limit of ${agent.config.maxTurns} turns` : result.result || result.subtype)
  }
  if (!agent.config.outputSchema) return result.result
  if (!('structured_output' in result)) throw new Error('claude finished without a schema-checked answer')
  return result.structured_output
}
