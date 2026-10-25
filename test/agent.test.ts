import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import reviewer from '../agents/reviewer/config.ts'
import { makeWorkspace, type Workspace } from './helpers.ts'

let ws: Workspace
const freshWorkspace = () => {
  ws = makeWorkspace()
  ws.writeRepoList([])
}
beforeEach(freshWorkspace)
afterEach(() => ws.cleanup())

/** Runs the Review Step in a new dry Run with the given Reviewer folder, returning its exit code and log. */
async function reviewWith(files: Record<string, string>) {
  const runId = `2026-10-22-0530-${ws.runIds().length + 1}`
  ws.prepareRun(runId, { dryRun: true })
  ws.writeAgent('reviewer', files)
  const result = await ws.agents('step', 'review', '--run', runId)
  return { status: result.status, log: ws.readRunFile(runId, 'logs', 'review.log') }
}

const configModule = (config: unknown) => `export default ${JSON.stringify(config)}\n`

test("the Review Step fails with a message naming what is wrong in the Reviewer's config", async () => {
  const cases: [unknown, RegExp][] = [
    [{ ...reviewer, worker: { ...reviewer.worker, effort: 'max' } }, /config\.worker\.effort must be one of low, medium, high/],
    [{ ...reviewer, fallbackWorker: { ...reviewer.fallbackWorker, name: 'gemini' } }, /config\.fallbackWorker\.name must be one of codex, claude-code, antigravity/],
    [{ ...reviewer, fallbackWorker: reviewer.worker }, /config\.fallbackWorker must name a different Worker from config\.worker/],
    [{ ...reviewer, worker: { name: 'antigravity', model: 'gemini-3.8-flash', effort: 'high' } }, /config\.worker can't be antigravity, which runs only as a fallbackWorker until its headless bugs are fixed/],
    [{ ...reviewer, permissions: 'everything' }, /config\.permissions must be "read-only" or \{ write: \[folders\] \}/],
    [{ ...reviewer, timeoutSeconds: 0 }, /config\.timeoutSeconds must be at least 1/],
    [{ ...reviewer, maxTurns: undefined }, /config\.maxTurns is missing/],
    [{ ...reviewer, inputs: { repo: 42 } }, /config\.inputs\.repo must be string/],
    [{ ...reviewer, timeout: 900 }, /config\.timeout is not allowed/],
  ]
  for (const [config, message] of cases) {
    const { status, log } = await reviewWith({ 'config.ts': configModule(config), 'instructions.md': '# Reviewer\n' })
    assert.equal(status, 1)
    assert.match(log, /Invalid config for the reviewer Agent/)
    assert.match(log, message)
  }
})

test("an Agent's Tools must be commands in its tools folder, and its skills can't allow themselves commands", async () => {
  const withTools = (tools: unknown) => configModule({ ...reviewer, tools })
  const skill = (frontmatter: string) => `---\nname: checklist\ndescription: What to check.\n${frontmatter}---\n\nCheck it.\n`
  const cases: [Record<string, string>, RegExp][] = [
    [{ 'config.ts': withTools({ blame: 'blame <file> <line>' }) }, /The reviewer Agent's config declares the Tool blame, but there is no .*[\\/]reviewer[\\/]tools[\\/]blame/],
    [{ 'config.ts': withTools({ blame: 'blame <file> <line>' }), 'tools/blame': 'git log -1\n' }, /The reviewer Agent's Tool .*[\\/]reviewer[\\/]tools[\\/]blame isn't executable/],
    [{ 'config.ts': withTools({ '../../bin/rm': 'rm <file>' }) }, /The reviewer Agent's config declares the Tool \.\.\/\.\.\/bin\/rm, which isn't a file name in its tools folder/],
    [{ 'config.ts': withTools({ blame: 42 }) }, /config\.tools\.blame must be string/],
    [{ 'config.ts': configModule(reviewer), 'skills/checklist/list.md': '- mounted\n' }, /The reviewer Agent's skill checklist has no SKILL\.md in .*[\\/]reviewer[\\/]skills[\\/]checklist/],
    [
      { 'config.ts': configModule(reviewer), 'skills/checklist/SKILL.md': skill('allowed-tools: Bash(rm:*)\n') },
      /The reviewer Agent's skill checklist sets allowed-tools in .*[\\/]SKILL\.md; declare the Tools it needs in the Agent's config instead/,
    ],
    [
      { 'config.ts': configModule(reviewer), 'skills/checklist/SKILL.md': skill('"allowed-tools": Bash(rm:*)\n').replaceAll('\n', '\r\n') },
      /The reviewer Agent's skill checklist sets allowed-tools/,
    ],
  ]
  for (const [files, message] of cases) {
    // Each case starts from an empty Agent folder.
    ws.cleanup()
    freshWorkspace()
    const { status, log } = await reviewWith({ 'instructions.md': '# Reviewer\n', ...files })
    assert.equal(status, 1)
    assert.match(log, message)
  }
})

test('an Agent folder without its instructions file fails with a clear message', async () => {
  const { status, log } = await reviewWith({ 'config.ts': configModule(reviewer) })

  assert.equal(status, 1)
  assert.match(log, /The reviewer Agent has no instructions\.md/)
})

test("this repo's Reviewer config is valid", async () => {
  const { status, log } = await reviewWith({ 'config.ts': configModule(reviewer), 'instructions.md': '# Reviewer\n' })

  assert.equal(status, 0, log)
})
