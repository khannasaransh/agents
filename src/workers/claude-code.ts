// The Claude Code Worker: runs an Agent through `claude --print`, Claude Code's headless mode, on
// Saransh's logged-in subscription, and reads the answer from its JSON result. The Agent's skills
// reach it as a plugin for that session only.
import { cpSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Agent } from '../agent.ts'
import type { ProcessResult } from '../process.ts'
import type { CallOptions, Inputs, Worker } from '../worker.ts'
import { agentPrompt, lastLine, runCommandLine, withTempFolder, writeFolders, type CommandLine } from './cli.ts'

interface ClaudeCodeOptions extends CallOptions {
  /** Where the Agent's skills are laid out as a plugin for the session. */
  pluginDir: string
}

/**
 * The `claude --print` command line for one call of `agent`, with the prompt on stdin. It never
 * uses --bare, which ignores Saransh's login.
 */
export function claudeCodeCommandLine(agent: Agent, inputs: Inputs, { cwd, model, effort, pluginDir }: ClaudeCodeOptions): CommandLine {
  const { outputSchema, maxTurns, timeoutSeconds } = agent.config
  const writable = writeFolders(agent, cwd)
  const hasSkills = agent.skills.length > 0
  const allowed = [...agent.tools.map((tool) => `Bash(${tool.path}:*)`), ...writable.map((folder) => `Edit(/${folder}/**)`)]
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
      // No settings files (Saransh's, or any the Repo commits), so no hooks, plugins, skills or allow
      // rules from them, and no MCP servers. File tools stay inside the folders the call may use.
      '--restricted',
      '--strict-mcp-config',
      // Anything not allowed here is denied without asking. Bash runs only the Agent's Tools and the
      // commands Claude Code itself counts as read-only, such as git log and git diff.
      '--permission-mode',
      'dontAsk',
      '--tools',
      ['Read', 'Grep', 'Glob', 'Bash', ...(writable.length ? ['Edit', 'Write'] : []), ...(hasSkills ? ['Skill'] : [])].join(','),
      // The Agent's skills, as a plugin for this session only. Its folder is added so a skill can read its own files.
      ...(hasSkills ? ['--plugin-dir', pluginDir, '--add-dir', pluginDir] : []),
      ...writable.flatMap((folder) => ['--add-dir', folder]),
      // An Edit rule covers every tool that writes files. `//` starts an absolute path.
      ...(allowed.length ? ['--allowedTools', ...allowed] : []),
    ],
    stdin: agentPrompt(agent, inputs),
    // A key or token in the environment would take precedence over Saransh's logged-in subscription.
    env: { ANTHROPIC_API_KEY: undefined, ANTHROPIC_AUTH_TOKEN: undefined },
    timeoutSeconds,
  }
}

export const claudeCodeWorker: Worker = {
  name: 'claude-code',
  call(agent, inputs, options) {
    return withTempFolder('agents-claude-code-', async (pluginDir) => {
      if (agent.skills.length) writeSessionPlugin(agent, pluginDir)
      return claudeCodeAnswer(agent, await runCommandLine(claudeCodeCommandLine(agent, inputs, { ...options, pluginDir }), options.cwd))
    })
  },
}

/**
 * Lays the Agent's skills out as a Claude Code plugin named after it, in `folder`. Each skill is
 * copied, not linked, so its files stay inside the folder the session may read.
 */
function writeSessionPlugin(agent: Agent, folder: string) {
  mkdirSync(join(folder, '.claude-plugin'))
  writeFileSync(join(folder, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: agent.name }))
  for (const skill of agent.skills) cpSync(skill.folder, join(folder, 'skills', skill.name), { recursive: true, dereference: true })
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
