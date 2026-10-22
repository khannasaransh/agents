// Command-line tests: each real Worker builds the right command line for an Agent's config. They
// never start a CLI.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import reviewer from '../agents/reviewer/config.ts'
import type { Agent, AgentConfig, Skill, Tool } from '../src/agent.ts'
import { claudeCodeCommandLine } from '../src/workers/claude-code.ts'
import { codexCommandLine } from '../src/workers/codex.ts'

const cwd = '/data/worktrees/crux_flutter-x1Yz'
// Tools in the Agents folder: two of the Reviewer's and one of the Docs Agent's. Only blame is ever declared.
const blame = '/agents/reviewer/tools/blame'
const secret = '/agents/reviewer/tools/secret'
const commit = '/agents/docs/tools/commit'
// Skills Codex would find by itself: its own, Saransh's, and the Repo's.
const foundSkills = ['/home/.codex/skills/.system/imagegen/SKILL.md', '/home/.agents/skills/review/SKILL.md', `${cwd}/.agents/skills/house-style/SKILL.md`]

const blameTool: Tool = { name: 'blame', path: blame, usage: 'blame <file> <line>: prints the commit that last changed that line' }
const checklist: Skill = {
  name: 'checklist',
  folder: '/agents/reviewer/skills/checklist',
  text: '---\nname: checklist\ndescription: What to check in a Flutter change.\n---\n\nCheck every `await` for a missing `mounted` check.\n',
}

const agent = (config: AgentConfig = reviewer, { tools = [], skills = [] }: { tools?: Tool[]; skills?: Skill[] } = {}): Agent => ({
  name: 'reviewer',
  folder: '/agents/reviewer',
  config,
  instructions: '# Reviewer\n\nReview the commits.\n',
  tools,
  skills,
})
const inputs = {
  repo: 'crux_flutter',
  branch: 'main',
  from: 'a'.repeat(40),
  to: 'b'.repeat(40),
  commits: [{ sha: 'b'.repeat(40), author: 'Asha', email: 'asha@example.com', date: '2026-10-21T10:00:00+05:30', subject: 'Add paywall' }],
}
const codexOptions = { cwd, model: 'gpt-6-astra', effort: 'high' as const, schemaFile: '/tmp/x/output-schema.json', undeclaredTools: [commit, blame, secret], foundSkills }
const claudeCodeOptions = { cwd, model: 'opus', effort: 'high', pluginDir: '/tmp/y/plugin' } as const

/** The values that follow each use of `flag`. */
const valuesOf = (args: string[], flag: string) => args.flatMap((arg, i) => (arg === flag ? [args[i + 1]] : []))

/** The permission profile a Codex command line sets up. */
const profileOf = (args: string[]) => valuesOf(args, '--config').find((value) => value.startsWith('permissions.agent='))

test('the Codex Worker runs a read-only Agent through codex exec with only its built-in tools, never running a Tool it may not or using a skill it finds itself, and asks for a schema-checked JSON answer', () => {
  const line = codexCommandLine(agent(), inputs, codexOptions)

  assert.equal(line.command, 'codex')
  assert.deepEqual(line.args, [
    'exec',
    '--ignore-user-config',
    '--ignore-rules',
    '--disable',
    'apps',
    '--disable',
    'plugins',
    '--disable',
    'browser_use',
    '--disable',
    'computer_use',
    '--disable',
    'image_generation',
    '--disable',
    'goals',
    '--disable',
    'tool_suggest',
    '--config',
    'web_search="disabled"',
    '--model',
    'gpt-6-astra',
    '--config',
    'model_reasoning_effort="high"',
    '--config',
    'default_permissions="agent"',
    '--config',
    `permissions.agent={extends=":read-only",filesystem={"${commit}"="deny","${blame}"="deny","${secret}"="deny"}}`,
    '--config',
    `skills.config=[${foundSkills.map((file) => `{path="${file}",enabled=false}`).join(',')}]`,
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

test('the Codex Worker lets an Agent write its named folders and nowhere else, not even the folder it runs in, and asks for no schema when the Agent has none', () => {
  const { args } = codexCommandLine(agent(writer), inputs, { ...codexOptions, effort: 'medium' })

  assert.equal(
    profileOf(args),
    `permissions.agent={extends=":read-only",filesystem={"${cwd}/wiki"="write","/Users/saransh/notes"="write","${commit}"="deny","${blame}"="deny","${secret}"="deny"}}`,
  )
  assert.ok(!args.includes('--sandbox'))
  assert.ok(!args.includes('--add-dir'))
  assert.ok(!args.includes('--output-schema'))
})

test("the Claude Code Worker runs a read-only Agent in print mode on Saransh's subscription, with built-in reading only and a schema-checked JSON answer", () => {
  const line = claudeCodeCommandLine(agent(), inputs, claudeCodeOptions)

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
  const { args } = claudeCodeCommandLine(agent(writer), inputs, claudeCodeOptions)

  assert.deepEqual(valuesOf(args, '--tools'), ['Read,Grep,Glob,Bash,Edit,Write'])
  assert.deepEqual(valuesOf(args, '--add-dir'), [`${cwd}/wiki`, '/Users/saransh/notes'])
  assert.deepEqual(args.slice(args.indexOf('--allowedTools') + 1), [`Edit(/${cwd}/wiki/**)`, 'Edit(//Users/saransh/notes/**)'])
  assert.deepEqual(valuesOf(args, '--permission-mode'), ['dontAsk'])
  assert.ok(!args.includes('--json-schema'))
})

test('the Claude Code Worker allows the Tools the Agent declares by their full paths, and denies every other command that is more than reading', () => {
  const { args } = claudeCodeCommandLine(agent(writer, { tools: [blameTool] }), inputs, claudeCodeOptions)

  assert.deepEqual(args.slice(args.indexOf('--allowedTools') + 1), [`Bash(${blame}:*)`, `Edit(/${cwd}/wiki/**)`, 'Edit(//Users/saransh/notes/**)'])
  assert.deepEqual(valuesOf(args, '--permission-mode'), ['dontAsk'])
})

test("the Claude Code Worker gives the Agent its skills as a plugin for this session only, in a folder the skills can read, and leaves them out of the prompt", () => {
  const { args, stdin } = claudeCodeCommandLine(agent(reviewer, { skills: [checklist] }), inputs, claudeCodeOptions)

  assert.deepEqual(valuesOf(args, '--tools'), ['Read,Grep,Glob,Bash,Skill'])
  assert.deepEqual(valuesOf(args, '--plugin-dir'), ['/tmp/y/plugin'])
  assert.deepEqual(valuesOf(args, '--add-dir'), ['/tmp/y/plugin'])
  assert.ok(!stdin.includes('mounted'), stdin)
})

test("the Codex Worker gives the Agent its skills as text in the prompt, with the folder each one's other files are in", () => {
  const { stdin } = codexCommandLine(agent(reviewer, { skills: [checklist] }), inputs, codexOptions)

  assert.ok(stdin.includes(`## Skills\n\n`), stdin)
  assert.ok(stdin.includes(`### checklist\n\nIts folder: \`${checklist.folder}\`\n\n${checklist.text.trim()}\n\n## Inputs`), stdin)
})

test("both Workers give the Agent its instructions, its Tools with their usage, each input with what it holds, and what to hand back, on stdin", () => {
  const lines = [
    codexCommandLine(agent(reviewer, { tools: [blameTool] }), inputs, { ...codexOptions, undeclaredTools: [commit, secret] }),
    claudeCodeCommandLine(agent(reviewer, { tools: [blameTool] }), inputs, claudeCodeOptions),
  ]

  for (const { stdin } of lines) {
    assert.ok(stdin.startsWith('# Reviewer\n\nReview the commits.\n'), stdin)
    assert.ok(stdin.includes(`## Tools\n\nBeyond reading and searching, these are the only commands you can run. Run each by its full path.\n\n- \`${blame}\`: ${blameTool.usage}\n`), stdin)
    assert.ok(stdin.includes(`### repo: ${reviewer.inputs.repo}\n\n\`\`\`\ncrux_flutter\n\`\`\``), stdin)
    assert.ok(stdin.includes(`### commits: ${reviewer.inputs.commits}\n\n\`\`\`json\n${JSON.stringify(inputs.commits, null, 2)}\n\`\`\``), stdin)
    assert.ok(stdin.includes(`- **findings:** ${reviewer.outputs.findings}`), stdin)
  }
})
