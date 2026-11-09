// The Cursor Worker: runs an Agent through `agent --print`, the Cursor CLI's headless mode, on
// Saransh's logged-in Cursor account. Grok 4.7's effort is part of the model id the CLI accepts, as
// `grok-4.7-xhigh` for extra high. The CLI has no schema flag and no switch that turns web
// search off, and ask mode is the read-only mode it does have. It takes its prompt only as an
// argument, never on stdin, so a prompt too long for a command line goes in a file it is told to read.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Agent } from '../agent.ts'
import type { ProcessResult } from '../process.ts'
import type { CallOptions, Inputs, Worker } from '../worker.ts'
import { agentPrompt, jsonResult, lastLine, runCommandLine, writeFolders, type CommandLine } from './cli.ts'

/**
 * The `agent --print` command line for one call of `agent`, with the prompt as its argument. The
 * CLI's sandbox exists only on the Mac and Linux, and refuses to start on Windows, so there a call
 * runs without it, which only a read-only call in ask mode may (`cursorWorker` refuses the rest).
 */
export function cursorCommandLine(agent: Agent, inputs: Inputs, { cwd, model, effort }: CallOptions, platform: NodeJS.Platform = process.platform): CommandLine {
  const readOnly = agent.config.permissions === 'read-only'
  return {
    command: 'agent',
    args: [
      '--print',
      '--output-format',
      'json',
      '--model',
      `${model}-${effort}`,
      // Headless, in this folder, with command execution sandboxed where the CLI has a sandbox. Ask
      // mode cannot edit. A call that may write has to force commands through, or the CLI stops to ask.
      '--trust',
      '--workspace',
      cwd,
      ...(platform === 'win32' ? [] : ['--sandbox', 'enabled']),
      ...(readOnly ? ['--mode', 'ask'] : ['--force', ...writeFolders(agent, cwd).flatMap((folder) => ['--add-dir', folder])]),
      cursorPrompt(agent, inputs, cwd),
    ],
    stdin: '',
    env: {},
    timeoutSeconds: agent.config.timeoutSeconds,
  }
}

/** What the Agent is told about the limits this CLI can actually hold it to. */
function cursorLimits(agent: Agent, cwd: string): string {
  const web = agent.config.webSearch ? '' : ' Do not search the web.'
  if (agent.config.permissions === 'read-only') return `You are in ask mode. Read and answer. Do not edit a file or run a command that changes anything.${web}`
  const folders = writeFolders(agent, cwd)
  return `Write only in these folders: ${folders.join(', ') || 'none'}.${web}`
}

/** The prompt, and, when the Agent has a schema, the instruction to hand back only that JSON. */
function cursorPrompt(agent: Agent, inputs: Inputs, cwd: string): string {
  const prompt = agentPrompt(agent, inputs, { inlineSkills: true, limits: cursorLimits(agent, cwd) })
  if (!agent.config.outputSchema) return prompt
  return `${prompt}\nHand back only the JSON object, with no markdown around it. It must match this JSON Schema:\n${JSON.stringify(agent.config.outputSchema, null, 2)}\n`
}

/**
 * The longest prompt given as the CLI's argument. Windows holds a command line to 32,767
 * characters, the program's path and every other argument among them, and a Book's inputs alone run
 * to hundreds of thousands.
 */
export const cursorArgumentLimit = 24_000

/** What the CLI is given in place of a prompt it reads from `file`. */
export function promptFilePointer(file: string, length: number): string {
  return `Your instructions and inputs are in ${file}: ${length} characters. Read all of it before you do anything else, in parts if it is long, and then do exactly what it says. Don't change that file.`
}

/** `line` with its prompt moved to prompt.md in `folder`, which the CLI is given to read. */
export function withPromptFile(line: CommandLine, folder: string): CommandLine {
  const prompt = line.args.at(-1)!
  const file = join(folder, 'prompt.md')
  writeFileSync(file, prompt)
  return { ...line, args: [...line.args.slice(0, -1), '--add-dir', folder, promptFilePointer(file, prompt.length)] }
}

export const cursorWorker: Worker = {
  name: 'cursor',
  async call(agent, inputs, options) {
    // Its sandbox holds commands, not reads: it can't keep an Agent from a folder, so it refuses a call that denies one.
    if (options.denyRead?.length) throw new Error(`The Cursor CLI can't keep the ${agent.name} Agent from reading ${options.denyRead.join(', ')}, so it isn't run there`)
    if (process.platform === 'win32' && agent.config.permissions !== 'read-only') throw new Error(`The Cursor CLI has no sandbox on Windows, so it runs only read-only Agents there, and the ${agent.name} Agent may write`)
    const line = cursorCommandLine(agent, inputs, options)
    if (line.args.at(-1)!.length <= cursorArgumentLimit) return cursorAnswer(agent, await runCommandLine(line, options.cwd))
    const folder = mkdtempSync(join(tmpdir(), 'agents-cursor-'))
    try {
      return cursorAnswer(agent, await runCommandLine(withPromptFile(line, folder), options.cwd))
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  },
}

/** The JSON result `agent --print --output-format json` prints, as far as reading its answer needs. */
interface CursorResult {
  subtype?: string
  is_error?: boolean
  result?: string
}

/** The Cursor CLI's answer. With a schema, the JSON object inside the text. Throws the CLI's own error when the call failed. */
function cursorAnswer(agent: Agent, ended: ProcessResult): unknown {
  let result: CursorResult
  try {
    result = jsonResult<CursorResult>('agent', ended)
  } catch (error) {
    throw new Error(loginHint(error instanceof Error ? error.message : String(error)))
  }
  if (result.is_error || result.subtype !== 'success' || ended.code !== 0) {
    throw new Error(loginHint(result.result || result.subtype || lastLine(ended.stderr) || `agent exited with ${ended.code}`))
  }
  if (result.result === undefined) throw new Error('agent finished without an answer')
  if (!agent.config.outputSchema) return result.result
  try {
    return jsonObjectFromAnswer(result.result)
  } catch {
    throw new Error(`agent answered with something that isn't JSON: ${result.result.slice(0, 200)}`)
  }
}

/**
 * The JSON object in an answer. A whole answer may be that object, a fenced block, or narration
 * the CLI joined in front of the object.
 */
export function jsonObjectFromAnswer(text: string): unknown {
  const whole = unfenced(text)
  try {
    return JSON.parse(whole)
  } catch {
    // The CLI joins every assistant message into one string, so the object can follow narration.
  }
  // The answer object contains smaller objects, such as one finding. Keep the longest one.
  let best: { length: number; value: unknown } | null = null
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== '{') continue
    const slice = balancedObject(text, start)
    if (!slice) continue
    try {
      const value = JSON.parse(slice)
      if (value && typeof value === 'object' && !Array.isArray(value) && (!best || slice.length > best.length)) {
        best = { length: slice.length, value }
      }
    } catch {
      // A brace inside narration.
    }
  }
  if (best) return best.value
  throw new Error('no JSON object')
}

/** The text of one `{...}` starting at `start`, with strings left intact, or null when it never closes. */
function balancedObject(text: string, start: number): string | null {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const char = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') depth++
    else if (char === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

/** A fenced JSON block, as a model writes one when nothing checks the shape for it, unwrapped. */
function unfenced(text: string): string {
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(text.trim())
  return (fenced?.[1] ?? text).trim()
}

/** The login the CLI asks for, named so a failed call says what to run. */
function loginHint(message: string): string {
  return /authentication required/i.test(message) ? `${message}; log in once with agent login` : message
}
