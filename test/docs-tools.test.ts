import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, test } from 'node:test'

// The Docs Agent's Tools, run as the Agent runs them: from the root of its worktree of the wiki.

let root: string
afterEach(() => rmSync(root, { recursive: true, force: true }))

const toolFile = (name: string) => fileURLToPath(new URL(`../agents/docs/tools/${name}`, import.meta.url))
const paywallPrd = '# Paywall PRD\n\nPremium subscribers see no paywall.\n'

/**
 * A worktree of a wiki with the InPix Codebase, the paywall PRD staged as the Docs Step stages it,
 * and stand-ins for the wiki's tools that record each run, exiting as `exits` says.
 */
function worktree(exits: Record<string, number> = {}): string {
  root = mkdtempSync(join(tmpdir(), 'agents-docs-tools-'))
  const folder = join(root, 'wiki')
  const files: Record<string, string> = {
    '_sources/inpix/README.md': '# InPix sources\n',
    '_runs/prds/inbox/Paywall_PRD.md': paywallPrd,
    ...Object.fromEntries(
      ['regions', 'stamp', 'check'].map((tool) => [
        `_wiki/tools/${tool}.mjs`,
        `import { appendFileSync } from 'node:fs'\nappendFileSync('../tool-runs.txt', '${tool}\\n')\nprocess.exitCode = ${exits[tool] ?? 0}\n`,
      ]),
    ),
  }
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, path)), { recursive: true })
    writeFileSync(join(folder, path), text)
  }
  return folder
}

const run = (cwd: string, tool: string, ...args: string[]) => spawnSync(process.execPath, [toolFile(tool), ...args], { cwd, encoding: 'utf8' })

test('prd add copies a staged file into the PRD sources of a Codebase the wiki has, and readies it for the PRD skill', () => {
  const folder = worktree()

  const added = run(folder, 'prd', 'add', '_runs/prds/inbox/Paywall_PRD.md', 'inpix', 'paywall')

  assert.equal(added.status, 0, added.stderr)
  assert.equal(readFileSync(join(folder, '_sources/inpix/PRD/Paywall_PRD.md'), 'utf8'), paywallPrd)
  assert.equal(readFileSync(join(folder, '_runs/prds/paywall/source.md'), 'utf8'), paywallPrd)
})

test("prd writes nowhere outside the wiki: it refuses a Codebase that isn't one of the wiki's folders, and a file the Step didn't stage", () => {
  const folder = worktree()
  writeFileSync(join(root, 'Elsewhere.md'), paywallPrd)

  for (const args of [
    ['add', '_runs/prds/inbox/Paywall_PRD.md', '../..', 'paywall'],
    ['add', '_runs/prds/inbox/Paywall_PRD.md', '..', 'paywall'],
    ['add', '../Elsewhere.md', 'inpix', 'paywall'],
    ['convert', '../Elsewhere.md'],
  ]) {
    const refused = run(folder, 'prd', ...args)
    assert.equal(refused.status, 2, `prd ${args.join(' ')}: ${refused.stdout}${refused.stderr}`)
  }
  assert.ok(!existsSync(join(root, 'PRD')))
  assert.ok(!existsSync(join(dirname(root), 'PRD', 'Paywall_PRD.md')))
  assert.ok(!existsSync(join(folder, '_sources/inpix/PRD')))
})

test("finish stops at the first of the wiki's tools that fails, exiting with its code", () => {
  const folder = worktree({ stamp: 3 })

  const finished = run(folder, 'finish', 'pins.txt', 'products/inpix/prds/paywall.md')

  assert.equal(finished.status, 3)
  assert.equal(readFileSync(join(root, 'tool-runs.txt'), 'utf8'), 'regions\nstamp\n')
})

test('finish exits 0 once each of the wiki\'s tools succeeds', () => {
  const folder = worktree()

  const finished = run(folder, 'finish', 'pins.txt', 'products/inpix/prds/paywall.md')

  assert.equal(finished.status, 0, finished.stderr)
  assert.equal(readFileSync(join(root, 'tool-runs.txt'), 'utf8'), 'regions\nstamp\ncheck\n')
})
