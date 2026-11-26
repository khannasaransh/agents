import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { loadRepos } from '../src/repos.ts'
import macRepos from '../repos.ts'
import windowsRepos from '../repos.windows.ts'

/** Runs `body` with these environment variables set, or removed where undefined, then restores them. */
async function withEnv(vars: Record<string, string | undefined>, body: () => Promise<void>) {
  const saved = Object.fromEntries(Object.keys(vars).map((name) => [name, process.env[name]]))
  const set = (values: Record<string, string | undefined>) => {
    for (const [name, value] of Object.entries(values)) value === undefined ? delete process.env[name] : (process.env[name] = value)
  }
  set(vars)
  try {
    await body()
  } finally {
    set(saved)
  }
}

test("AGENTS_REPOS_FILE in the env file picks the Repo list, taken from this repo's folder when relative", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'agents-repos-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const envFile = join(dir, '.env')
  writeFileSync(envFile, 'AGENTS_REPOS_FILE=repos.windows.ts\n')
  await withEnv({ AGENTS_ENV_FILE: envFile, AGENTS_REPOS_FILE: undefined }, async () => {
    assert.deepEqual(await loadRepos(), windowsRepos)
  })
})

test('AGENTS_REPOS_FILE in the environment wins over the env file', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'agents-repos-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const envFile = join(dir, '.env')
  const listFile = join(dir, 'list.ts')
  writeFileSync(envFile, 'AGENTS_REPOS_FILE=repos.windows.ts\n')
  writeFileSync(listFile, "export default [{ name: 'one', team: 'ai', codebase: 'Shared', remote: 'r', folder: 'D:/one', branch: 'main' }]\n")
  await withEnv({ AGENTS_ENV_FILE: envFile, AGENTS_REPOS_FILE: listFile }, async () => {
    assert.deepEqual((await loadRepos()).map((repo) => repo.folder), ['D:/one'])
  })
})

test("the Windows Repo list is repos.ts with each folder under D:/Saransh/inshorts/github", () => {
  assert.equal(windowsRepos.length, macRepos.length)
  windowsRepos.forEach((repo, i) => {
    const mac = macRepos[i]
    assert.deepEqual({ ...repo, folder: mac.folder }, mac)
    assert.equal(repo.folder, `D:/Saransh/inshorts/github/${repo.team}/${repo.name}`)
  })
})
