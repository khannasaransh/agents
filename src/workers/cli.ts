// What the CLI Workers share: the prompt an Agent call starts from, and running a CLI under the
// Agent's timeout.
import { resolve } from 'node:path'
import type { Agent } from '../agent.ts'
import { runProcess, type ProcessResult } from '../process.ts'
import type { Inputs } from '../worker.ts'

/** How to start a Worker's CLI for one Agent call. */
export interface CommandLine {
  command: string
  args: string[]
  /** The prompt, written to the CLI's stdin. */
  stdin: string
  /** Changes to the CLI's environment. An undefined value removes that variable. */
  env: Record<string, string | undefined>
  /** The CLI and everything it started are ended once this passes. */
  timeoutSeconds: number
}

/** The prompt for an Agent call: its instructions, each input with what it holds, and what to hand back. */
export function agentPrompt(agent: Agent, inputs: Inputs): string {
  const { inputs: declared, outputs } = agent.config
  const inputSections = Object.entries(declared).map(([name, holds]) => {
    const value = inputs[name]
    const block = typeof value === 'string' ? `\`\`\`\n${value}\n\`\`\`` : `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``
    return `### ${name}: ${holds}\n\n${block}`
  })
  const outputLines = Object.entries(outputs).map(([name, holds]) => `- **${name}:** ${holds}`)
  return [agent.instructions.trim(), '## Inputs', ...inputSections, '## What to hand back', outputLines.join('\n')].join('\n\n') + '\n'
}

/** The folders an Agent may write, resolved against the folder it runs in; none when it is read-only. */
export function writeFolders(agent: Agent, cwd: string): string[] {
  const { permissions } = agent.config
  return permissions === 'read-only' ? [] : permissions.write.map((folder) => resolve(cwd, folder))
}

/** Runs a command line in `cwd` and returns how it ended. Rejects when it can't start or runs past its timeout. */
export async function runCommandLine(line: CommandLine, cwd: string): Promise<ProcessResult> {
  const { stdin, env, timeoutSeconds } = line
  const ended = await runProcess(line.command, line.args, { cwd, env, stdin, timeoutMs: timeoutSeconds * 1000 })
  if (ended.timedOut) throw new Error(`timed out after ${timeoutSeconds}s`)
  return ended
}

/** The last non-empty line a CLI wrote, which is usually its error. */
export function lastLine(text: string): string {
  return text.trim().split('\n').at(-1) ?? ''
}
