// Command-line tests: each real Worker builds the right command line for an Agent's config. They
// never start a CLI.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import reviewer from '../agents/reviewer/config.ts'
import type { Agent, AgentConfig } from '../src/agent.ts'
import { claudeCodeCommandLine } from '../src/workers/claude-code.ts'
import { codexCommandLine } from '../src/workers/codex.ts'

const cwd = '/data/worktrees/crux_flutter-x1Yz'
const agent = (config: AgentConfig = reviewer): Agent => ({ name: 'reviewer', folder: '/agents/reviewer', config, instructions: '# Reviewer\n\nReview the commits.\n' })
const inputs = {
  repo: 'crux_flutter',
  branch: 'main',
  from: 'a'.repeat(40),
  to: 'b'.repeat(40),
  commits: [{ sha: 'b'.repeat(40), author: 'Asha', email: 'asha@example.com', date: '2026-10-21T10:00:00+05:30', subject: 'Add paywall' }],
}

test('the Codex Worker runs a read-only Agent through codex exec in its read-only sandbox, asking for a schema-checked JSON answer', () => {
  const line = codexCommandLine(agent(), inputs, { cwd, model: 'gpt-6-astra', effort: 'high', schemaFile: '/tmp/x/output-schema.json' })

  assert.equal(line.command, 'codex')
  assert.deepEqual(line.args, [
    'exec',
    '--ignore-user-config',
    '--model',
    'gpt-6-astra',
    '--config',
    'model_reasoning_effort="high"',
    '--sandbox',
    'read-only',
    '--cd',
    cwd,
    '--json',
    '--output-schema',
    '/tmp/x/output-schema.json',
    '-',
  ])
  assert.equal(line.timeoutSeconds, 900)
})

/** An Agent that may write two folders, one given relative to the folder it runs in, and returns free text. */
const writer: AgentConfig = { ...reviewer, permissions: { write: ['wiki', '/Users/saransh/notes'] }, outputSchema: undefined }

/** The values that follow each use of `flag`. */
const valuesOf = (args: string[], flag: string) => args.flatMap((arg, i) => (arg === flag ? [args[i + 1]] : []))

test("the Codex Worker lets an Agent write its named folders but not the temporary ones, and asks for no schema when the Agent has none", () => {
  const { args } = codexCommandLine(agent(writer), inputs, { cwd, model: 'gpt-6-astra', effort: 'medium', schemaFile: '/tmp/x/output-schema.json' })

  assert.deepEqual(valuesOf(args, '--sandbox'), ['workspace-write'])
  assert.deepEqual(valuesOf(args, '--add-dir'), [`${cwd}/wiki`, '/Users/saransh/notes'])
  assert.deepEqual(valuesOf(args, '--config').slice(1), ['sandbox_workspace_write.exclude_slash_tmp=true', 'sandbox_workspace_write.exclude_tmpdir_env_var=true'])
  assert.ok(!args.includes('--output-schema'))
})

test("the Claude Code Worker runs a read-only Agent in print mode on Saransh's subscription, with built-in reading only and a schema-checked JSON answer", () => {
  const line = claudeCodeCommandLine(agent(), inputs, { cwd, model: 'opus', effort: 'high' })

  assert.equal(line.command, 'claude')
  assert.deepEqual(line.args, [
    '--print',
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(reviewer.outputSchema),
    '--model',
    'opus',
    '--effort',
    'high',
    '--max-turns',
    '40',
    '--restricted',
    '--strict-mcp-config',
    '--permission-mode',
    'dontAsk',
    '--tools',
    'Read,Grep,Glob,Bash',
  ])
  assert.deepEqual(line.env, { ANTHROPIC_API_KEY: undefined, ANTHROPIC_AUTH_TOKEN: undefined })
  assert.equal(line.timeoutSeconds, 900)
})

test('the Claude Code Worker lets an Agent edit only inside its named folders, and asks for no schema when the Agent has none', () => {
  const { args } = claudeCodeCommandLine(agent(writer), inputs, { cwd, model: 'opus', effort: 'high' })

  assert.deepEqual(valuesOf(args, '--tools'), ['Read,Grep,Glob,Bash,Edit,Write'])
  assert.deepEqual(valuesOf(args, '--add-dir'), [`${cwd}/wiki`, '/Users/saransh/notes'])
  assert.deepEqual(args.slice(args.indexOf('--allowedTools') + 1), [`Edit(/${cwd}/wiki/**)`, 'Edit(//Users/saransh/notes/**)'])
  assert.deepEqual(valuesOf(args, '--permission-mode'), ['dontAsk'])
  assert.ok(!args.includes('--json-schema'))
})

test("both Workers give the Agent its instructions, each input with what it holds, and what to hand back, on stdin", () => {
  const lines = [
    codexCommandLine(agent(), inputs, { cwd, model: 'gpt-6-astra', effort: 'high', schemaFile: '/tmp/x/output-schema.json' }),
    claudeCodeCommandLine(agent(), inputs, { cwd, model: 'opus', effort: 'high' }),
  ]

  for (const { stdin } of lines) {
    assert.ok(stdin.startsWith('# Reviewer\n\nReview the commits.\n'), stdin)
    assert.ok(stdin.includes(`### repo: ${reviewer.inputs.repo}\n\n\`\`\`\ncrux_flutter\n\`\`\``), stdin)
    assert.ok(stdin.includes(`### commits: ${reviewer.inputs.commits}\n\n\`\`\`json\n${JSON.stringify(inputs.commits, null, 2)}\n\`\`\``), stdin)
    assert.ok(stdin.includes(`- **findings:** ${reviewer.outputs.findings}`), stdin)
  }
})
