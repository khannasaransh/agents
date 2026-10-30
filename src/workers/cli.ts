// What the CLI Workers share: the prompt an Agent call starts from, a temporary folder for what a
// call needs outside the folder it runs in, and running a CLI under the Agent's timeout.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Agent } from '../agent.ts'
import { runProcess, type ProcessResult } from '../process.ts'
import type { Inputs } from '../worker.ts'

/** How to start a Worker's CLI for one Agent call. */
export interface CommandLine {
  command: string
  args: string[]
  /** What is written to the CLI's stdin: the prompt, unless the CLI takes it as an argument. */
  stdin: string
  /** Changes to the CLI's environment. An undefined value removes that variable. */
  env: Record<string, string | undefined>
  /** The CLI and everything it started are ended once this passes. */
  timeoutSeconds: number
}

/**
 * The prompt for an Agent call: its instructions, its Tools with their usage, each input with what
 * it holds, and what to hand back. With `inlineSkills`, its skills are written out too, for a Worker
 * that can't be given them any other way. With `limits`, it is told what its Worker refuses, for
 * a Worker that ends a call at the first refusal.
 */
export function agentPrompt(agent: Agent, inputs: Inputs, { inlineSkills = false, limits = '' } = {}): string {
  const { inputs: declared, outputs } = agent.config
  const limitSection = limits ? ['## Limits', limits] : []
  const tools = agent.tools.length
    ? ['## Tools', 'Beyond reading and searching, these are the only commands you can run. Run each by its full path.', agent.tools.map((tool) => `- \`${tool.path}\`: ${tool.usage}`).join('\n')]
    : []
  const skills =
    inlineSkills && agent.skills.length
      ? [
          '## Skills',
          "Follow a skill when the task calls for it. A skill's other files are in its folder.",
          ...agent.skills.map((skill) => `### ${skill.name}\n\nIts folder: \`${skill.folder}\`\n\n${skill.text.trim()}`),
        ]
      : []
  const inputSections = Object.entries(declared).map(([name, holds]) => {
    const value = inputs[name]
    const block = typeof value === 'string' ? `\`\`\`\n${value}\n\`\`\`` : `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``
    return `### ${name}: ${holds}\n\n${block}`
  })
  const outputLines = Object.entries(outputs).map(([name, holds]) => `- **${name}:** ${holds}`)
  return [agent.instructions.trim(), ...limitSection, ...tools, ...skills, '## Inputs', ...inputSections, '## What to hand back', outputLines.join('\n')].join('\n\n') + '\n'
}

/** The folders an Agent may write, resolved against the folder it runs in; none when it is read-only. */
export function writeFolders(agent: Agent, cwd: string): string[] {
  const { permissions } = agent.config
  return permissions === 'read-only' ? [] : permissions.write.map((folder) => resolve(cwd, folder))
}

/** Runs `use` with a new temporary folder, which is removed afterwards. */
export async function withTempFolder<T>(prefix: string, use: (folder: string) => Promise<T>): Promise<T> {
  const folder = mkdtempSync(join(tmpdir(), prefix))
  try {
    return await use(folder)
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
}

/** Runs a command line in `cwd` and returns how it ended. Rejects when it can't start or runs past its timeout. */
export async function runCommandLine(line: CommandLine, cwd: string, onResult?: (result: ProcessResult) => void): Promise<ProcessResult> {
  const { stdin, env, timeoutSeconds } = line
  const ended = await runProcess(line.command, line.args, { cwd, env, stdin, timeoutMs: timeoutSeconds * 1000 })
  onResult?.(ended)
  if (ended.timedOut) throw new Error(`timed out after ${timeoutSeconds}s`)
  return ended
}

/** The JSON result a CLI printed. Throws what it said instead when it printed none. */
export function jsonResult<T>(command: string, { code, stdout, stderr }: ProcessResult): T {
  try {
    return JSON.parse(stdout)
  } catch {
    throw new Error(lastLine(stderr) || lastLine(stdout) || `${command} exited with ${code}`)
  }
}

/** The last non-empty line a CLI wrote, which is usually its error. */
export function lastLine(text: string): string {
  return text.trim().split('\n').at(-1) ?? ''
}
