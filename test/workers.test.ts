// Command-line tests: each real Worker builds the right command line for an Agent's config. They
// never start a CLI.
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import reviewer from '../agents/reviewer/config.ts'
import type { Agent, AgentConfig, Skill, Tool } from '../src/agent.ts'
import { antigravityCustomAgent, antigravityCommandLine, antigravityPermissions } from '../src/workers/antigravity.ts'
import { claudeCodeCommandLine } from '../src/workers/claude-code.ts'
import type { CommandLine } from '../src/workers/cli.ts'
import { codexCommandLine } from '../src/workers/codex.ts'

// Absolute paths as this platform spells them: on Windows, on the current drive.
const cwd = resolve('/data/worktrees/crux_flutter-x1Yz')
const wiki = join(cwd, 'wiki')
const notes = resolve('/Users/saransh/notes')
// Claude Code's rules spell a Windows path in its POSIX form, with its drive as the first folder.
const drive = process.platform === 'win32' ? `/${process.cwd()[0].toLowerCase()}` : ''
const wikiEdit = `Edit(/${drive}/data/worktrees/crux_flutter-x1Yz/wiki/**)`
const notesEdit = `Edit(/${drive}/Users/saransh/notes/**)`
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
const antigravityHome = '/agents-data/antigravity-home'
const antigravityOptions = { cwd, model: 'gemini-3.8-flash', effort: 'high', home: antigravityHome } as const

/** The values that follow each use of `flag`. */
const valuesOf = (args: string[], flag: string) => args.flatMap((arg, i) => (arg === flag ? [args[i + 1]] : []))

/** The prompt a command line gives its CLI: on stdin, or in Antigravity's --print option. */
const promptOf = ({ args, stdin }: CommandLine) => stdin || args.find((arg) => arg.startsWith('--print='))!.slice('--print='.length)

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
    `skills.config=[${foundSkills.map((file) => `{path=${JSON.stringify(file)},enabled=false}`).join(',')}]`,
    '--cd',
    cwd,
    '--skip-git-repo-check',
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
    `permissions.agent={extends=":read-only",filesystem={${JSON.stringify(wiki)}="write",${JSON.stringify(notes)}="write","${commit}"="deny","${blame}"="deny","${secret}"="deny"}}`,
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
  assert.deepEqual(valuesOf(args, '--add-dir'), [wiki, notes])
  assert.deepEqual(args.slice(args.indexOf('--allowedTools') + 1), [wikiEdit, notesEdit])
  assert.deepEqual(valuesOf(args, '--permission-mode'), ['dontAsk'])
  assert.ok(!args.includes('--json-schema'))
})

test('the Claude Code Worker allows the Tools the Agent declares by their full paths, and denies every other command that is more than reading', () => {
  const { args } = claudeCodeCommandLine(agent(writer, { tools: [blameTool] }), inputs, claudeCodeOptions)

  assert.deepEqual(args.slice(args.indexOf('--allowedTools') + 1), [`Bash(${blame}:*)`, wikiEdit, notesEdit])
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

test("the Antigravity Worker runs an Agent through print mode in its sandbox, on the Pipeline's own Antigravity home rather than Saransh's, and asks for a schema-checked JSON answer", () => {
  const line = antigravityCommandLine(agent(), inputs, antigravityOptions)

  assert.equal(line.command, 'agy')
  assert.deepEqual(line.args, [
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(reviewer.outputSchema),
    '--model',
    'gemini-3.8-flash',
    '--effort',
    'high',
    '--agent',
    'pipeline-reviewer',
    '--sandbox',
    '--disable-slash-commands',
    `--print=${promptOf(line)}`,
  ])
  assert.equal(line.stdin, '')
  assert.deepEqual(line.env, { HOME: antigravityHome, AGY_ADC_AUTH: undefined })
  assert.equal(line.timeoutSeconds, 900)
})

test("the Antigravity Worker runs an Agent as a custom agent with only the tools to read files, run commands, write files when it may, and finish, which takes on none of Antigravity's or the Repo's skills, rules or plugins", () => {
  assert.deepEqual(antigravityCustomAgent(agent()), {
    name: 'pipeline-reviewer',
    definition: "---\nname: pipeline-reviewer\ndescription: The reviewer Agent of Saransh's Pipeline.\ntools: [read_file, run_command, finish]\ninheritCustomizations: false\n---\n\nFollow the prompt.\n",
  })
  assert.match(antigravityCustomAgent(agent(writer)).definition, /\ntools: \[read_file, run_command, write_file, edit_file, finish\]\n/)
})

// The git data of the worktree the call runs in, kept in its clone.
const gitDir = '/Users/saransh/flutter/crux_flutter/.git'

test("the Antigravity Worker's sandbox reads only the folder a read-only Agent runs in, its git data, the Tools the Agent declares and its skills, and it writes nothing, runs no other Tool and reaches no network", () => {
  const permissions = antigravityPermissions(agent(reviewer, { tools: [blameTool], skills: [checklist] }), { cwd, gitDir, undeclaredTools: [commit, secret] })

  assert.deepEqual(permissions, {
    allow: [`read_file(${gitDir})`, `read_file(${blame})`, `read_file(${checklist.folder})`],
    deny: [`read_file(${commit})`, `read_file(${secret})`, 'write_file(*)', 'read_url(*)', 'execute_url(*)', 'mcp(*)'],
  })
})

test('the Antigravity Worker lets an Agent write its named folders, by their full paths, and asks for no schema when the Agent has none', () => {
  const { allow, deny } = antigravityPermissions(agent(writer), { cwd, undeclaredTools: [] })
  const { args } = antigravityCommandLine(agent(writer), inputs, antigravityOptions)

  assert.deepEqual(allow, [`write_file(${wiki})`, `write_file(${notes})`])
  assert.ok(!deny.includes('write_file(*)'))
  assert.ok(!args.includes('--json-schema'))
})

test("the Antigravity Worker gives the Agent its skills as text in the prompt, with the folder each one's other files are in, and tells it to stay inside the sandbox", () => {
  const prompt = promptOf(antigravityCommandLine(agent(reviewer, { skills: [checklist] }), inputs, antigravityOptions))

  assert.ok(prompt.includes(`### checklist\n\nIts folder: \`${checklist.folder}\`\n\n${checklist.text.trim()}\n\n## Inputs`), prompt)
  assert.match(prompt, /\n## Limits\n\nYour commands run in a sandbox .*never ask to run a command outside the sandbox.*a refusal ends your call\.\n/)
})

test("every Worker gives the Agent its instructions, its Tools with their usage, each input with what it holds, and what to hand back", () => {
  const lines = [
    codexCommandLine(agent(reviewer, { tools: [blameTool] }), inputs, { ...codexOptions, undeclaredTools: [commit, secret] }),
    claudeCodeCommandLine(agent(reviewer, { tools: [blameTool] }), inputs, claudeCodeOptions),
    antigravityCommandLine(agent(reviewer, { tools: [blameTool] }), inputs, antigravityOptions),
  ]

  for (const stdin of lines.map(promptOf)) {
    assert.ok(stdin.startsWith('# Reviewer\n\nReview the commits.\n'), stdin)
    assert.ok(stdin.includes(`## Tools\n\nBeyond reading and searching, these are the only commands you can run. Run each by its full path.\n\n- \`${blame}\`: ${blameTool.usage}\n`), stdin)
    assert.ok(stdin.includes(`### repo: ${reviewer.inputs.repo}\n\n\`\`\`\ncrux_flutter\n\`\`\``), stdin)
    assert.ok(stdin.includes(`### commits: ${reviewer.inputs.commits}\n\n\`\`\`json\n${JSON.stringify(inputs.commits, null, 2)}\n\`\`\``), stdin)
    assert.ok(stdin.includes(`- **findings:** ${reviewer.outputs.findings}`), stdin)
  }
})
