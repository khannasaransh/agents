import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import reviewer from '../agents/reviewer/config.ts'
import type { FetchResult } from '../steps/fetch.ts'
import type { ReviewResult } from '../steps/review.ts'
import { makeWorkspace, type Workspace } from './helpers.ts'

let ws: Workspace
afterEach(() => ws.cleanup())

const runId = '2026-10-22-0530'
const sha = (n: number) => String(n).repeat(40)

const changed = (repo: string): FetchResult => ({
  repo,
  team: 'flutter',
  branch: 'main',
  previous: sha(1),
  status: 'new-commits',
  head: sha(2),
  commits: [{ sha: sha(2), author: 'Asha', email: 'asha@example.com', date: '2026-10-21T10:00:00+05:30', subject: 'Change' }],
})

const reviewed = (repo: string, memory: string | null): ReviewResult => ({
  repo,
  team: 'flutter',
  branch: 'main',
  from: sha(1),
  to: sha(2),
  status: 'reviewed',
  summary: 'Fine.',
  findings: [],
  memory,
})

const saveState = () => ws.agents('step', 'save-state', '--run', runId)

/** Sets how the Reviewer's Memory changes are handled, in its config. */
function reviewerMemoryChanges(memoryChanges: 'apply' | 'review') {
  ws.writeAgent('reviewer', { 'config.ts': `export default ${JSON.stringify({ ...reviewer, memoryChanges })}\n`, 'instructions.md': '# Reviewer\n' })
}

/** Prepares a Run whose Reviewer proposed `memory` for each Repo, then runs its Save state. */
async function saveStateAfterReviews(proposals: Record<string, string | null>, { memoryChanges }: { memoryChanges?: 'apply' | 'review' } = {}) {
  if (memoryChanges) reviewerMemoryChanges(memoryChanges)
  ws.writeRepoList([])
  ws.prepareRun(runId)
  ws.writeRepoState(Object.fromEntries(Object.keys(proposals).map((repo) => [repo, { lastReviewed: sha(1) }])))
  for (const [repo, memory] of Object.entries(proposals)) {
    ws.writeRunFile(runId, `fetch/${repo}.json`, changed(repo))
    ws.writeRunFile(runId, `review/${repo}.json`, reviewed(repo, memory))
  }
  const result = await saveState()
  assert.equal(result.status, 0, result.stderr)
}

const oldMemory = '# crux_flutter\n\n- Prices come from the payments service.\n'
const newMemory = '# crux_flutter\n\n- Prices come from the payments service.\n- Feature flags live in lib/flags.dart.\n'

/** What the Run records about a change to one of the Reviewer's Memory files, without its time. */
function recordedChange(repo: string) {
  const { decidedAt, ...change } = JSON.parse(ws.readRunFile(runId, 'memory', 'reviewer', `${repo}.json`))
  assert.ok(!Number.isNaN(Date.parse(decidedAt)), decidedAt)
  return change
}

test("by default Save state applies the Reviewer's proposed Memory and records the change in the Run, once however often it is re-run", async () => {
  ws = makeWorkspace()
  ws.writeMemory('reviewer', 'crux_flutter', oldMemory)

  await saveStateAfterReviews({ crux_flutter: newMemory, 'inpix-panel': null })

  assert.equal(ws.readMemory('reviewer', 'crux_flutter'), newMemory)
  assert.equal(ws.readMemory('reviewer', 'inpix-panel'), null)
  assert.deepEqual(recordedChange('crux_flutter'), { agent: 'reviewer', name: 'crux_flutter', decision: 'applied', proposed: newMemory, before: oldMemory, after: newMemory })
  assert.deepEqual(ws.runFiles(runId, 'memory/reviewer'), ['crux_flutter.json'])
  assert.match((await ws.agents('memory')).stdout, /^No Memory changes are waiting for you\.$/m)

  const rerun = await saveState()

  assert.equal(rerun.status, 0, rerun.stderr)
  assert.equal(recordedChange('crux_flutter').before, oldMemory)
})

test("an Agent whose config sets memoryChanges to 'apply' has its proposals applied, just as by default", async () => {
  ws = makeWorkspace()

  await saveStateAfterReviews({ crux_flutter: newMemory }, { memoryChanges: 'apply' })

  assert.equal(ws.readMemory('reviewer', 'crux_flutter'), newMemory)
  assert.equal(recordedChange('crux_flutter').decision, 'applied')
})

test("with memoryChanges set to 'review', Save state queues the Reviewer's proposed Memory for Saransh, and `agents memory` shows it as a change to the Memory he has", async () => {
  ws = makeWorkspace()
  ws.writeMemory('reviewer', 'crux_flutter', oldMemory)

  await saveStateAfterReviews({ crux_flutter: newMemory }, { memoryChanges: 'review' })
  const listed = await ws.agents('memory')

  assert.equal(listed.status, 0, listed.stderr)
  assert.equal(ws.readMemory('reviewer', 'crux_flutter'), oldMemory)
  assert.match(listed.stdout, /^reviewer crux_flutter, proposed in Run 2026-10-22-0530:\n/m)
  assert.match(listed.stdout, /\n \n - Prices come from the payments service\.\n\+- Feature flags live in lib\/flags\.dart\.\n/)
  assert.match(listed.stdout, /agents memory accept reviewer crux_flutter/)
})

test('a Run whose Reviewer proposes no Memory change applies nothing, queues nothing and leaves every Memory file as it is', async () => {
  for (const memoryChanges of ['apply', 'review'] as const) {
    ws?.cleanup()
    ws = makeWorkspace()
    ws.writeMemory('reviewer', 'crux_flutter', oldMemory)

    await saveStateAfterReviews({ crux_flutter: null, 'inpix-panel': null }, { memoryChanges })

    assert.match((await ws.agents('memory')).stdout, /^No Memory changes are waiting for you\.$/m)
    assert.equal(ws.readMemory('reviewer', 'crux_flutter'), oldMemory)
    assert.equal(ws.readMemory('reviewer', 'inpix-panel'), null)
    assert.deepEqual(ws.runFiles(runId, 'memory'), [])
  }
})

test('the Brief lists the Memory changes waiting for Saransh, before its Run health', async () => {
  ws = makeWorkspace()
  await saveStateAfterReviews({ crux_flutter: newMemory, 'inpix-panel': null }, { memoryChanges: 'review' })

  const result = await ws.agents('step', 'brief', '--run', runId)

  assert.equal(result.status, 0, result.stderr)
  const brief = ws.readRunFile(runId, 'brief.md')
  assert.match(
    brief,
    /\n## Memory changes waiting for you\n\n- reviewer crux_flutter, proposed in Run 2026-10-22-0530\n\nReview them with `agents memory`\.\n\n## Run health\n/,
  )
  assert.doesNotMatch(brief, /reviewer inpix-panel/)
})

/** Prepares a Run whose PM Agent proposed `memory`, then runs its Save state. */
async function saveStateAfterPm(memory: string | null, { dryRun = false, memoryRead }: { dryRun?: boolean; memoryRead?: string } = {}) {
  ws.writeRepoList([])
  ws.prepareRun(runId, { dryRun })
  ws.writeRunFile(runId, 'pm.json', { status: 'answered', repoLines: [], highlights: [], todos: [], memory, memoryRead })
  const result = await saveState()
  assert.equal(result.status, 0, result.stderr)
}

const oldOpenItems = '- 2026-10-21: the inpix-panel login bug is still open.\n'
const newOpenItems = '- 2026-10-21: the inpix-panel login bug is still open.\n- 2026-10-22: download the payments revamp PRD.\n'

test("Save state applies the PM Agent's proposed Memory and records the change in the Run, once however often it is re-run", async () => {
  ws = makeWorkspace()
  ws.writeMemory('pm', 'notes', oldOpenItems)

  await saveStateAfterPm(newOpenItems)

  assert.equal(ws.readMemory('pm', 'notes'), newOpenItems)
  const { decidedAt, ...change } = JSON.parse(ws.readRunFile(runId, 'memory', 'pm', 'notes.json'))
  assert.deepEqual(change, { agent: 'pm', name: 'notes', decision: 'applied', proposed: newOpenItems, before: oldOpenItems, after: newOpenItems })

  const rerun = await saveState()

  assert.equal(rerun.status, 0, rerun.stderr)
  assert.equal(JSON.parse(ws.readRunFile(runId, 'memory', 'pm', 'notes.json')).before, oldOpenItems)
})

test("a dry run's PM Memory came from the fake Worker, so Save state never applies it", async () => {
  ws = makeWorkspace()
  ws.writeMemory('pm', 'notes', oldOpenItems)

  await saveStateAfterPm(newOpenItems, { dryRun: true })

  assert.equal(ws.readMemory('pm', 'notes'), oldOpenItems)
  assert.deepEqual(ws.runFiles(runId, 'memory'), [])
})

test('accepting a proposal makes it the Memory the next Run reads, and records the change in the Run that proposed it', async () => {
  ws = makeWorkspace()
  ws.writeMemory('reviewer', 'crux_flutter', oldMemory)
  await saveStateAfterReviews({ crux_flutter: newMemory }, { memoryChanges: 'review' })

  const accepted = await ws.agents('memory', 'accept', 'reviewer', 'crux_flutter')

  assert.equal(accepted.status, 0, accepted.stderr)
  assert.equal(ws.readMemory('reviewer', 'crux_flutter'), newMemory)
  assert.match((await ws.agents('memory')).stdout, /^No Memory changes are waiting for you\.$/m)
  assert.deepEqual(recordedChange('crux_flutter'), { agent: 'reviewer', name: 'crux_flutter', decision: 'accepted', proposed: newMemory, before: oldMemory, after: newMemory })
})

test('rejecting a proposal leaves the Memory as Saransh has it, and records the rejection in the Run that proposed it', async () => {
  ws = makeWorkspace()
  ws.writeMemory('reviewer', 'crux_flutter', oldMemory)
  await saveStateAfterReviews({ crux_flutter: newMemory }, { memoryChanges: 'review' })

  const rejected = await ws.agents('memory', 'reject', 'reviewer', 'crux_flutter')

  assert.equal(rejected.status, 0, rejected.stderr)
  assert.equal(ws.readMemory('reviewer', 'crux_flutter'), oldMemory)
  assert.match((await ws.agents('memory')).stdout, /^No Memory changes are waiting for you\.$/m)
  assert.deepEqual(recordedChange('crux_flutter'), { agent: 'reviewer', name: 'crux_flutter', decision: 'rejected', proposed: newMemory, before: oldMemory, after: oldMemory })
})

test("a proposal whose Memory changed after the Agent read it, by Saransh's hand or a later Run, waits for Saransh instead of undoing that change", async () => {
  ws = makeWorkspace()
  const byHand = `${oldMemory}- Saransh: the paywall copy is final.\n`
  ws.writeMemory('reviewer', 'crux_flutter', byHand)
  ws.writeRepoList([])
  ws.prepareRun(runId)
  ws.writeRepoState({ crux_flutter: { lastReviewed: sha(1) } })
  ws.writeRunFile(runId, 'fetch/crux_flutter.json', changed('crux_flutter'))
  ws.writeRunFile(runId, 'review/crux_flutter.json', { ...reviewed('crux_flutter', newMemory), memoryRead: oldMemory })

  const result = await saveState()

  assert.equal(result.status, 0, result.stderr)
  assert.equal(ws.readMemory('reviewer', 'crux_flutter'), byHand)
  assert.deepEqual(ws.runFiles(runId, 'memory'), [])
  assert.match((await ws.agents('memory')).stdout, /^reviewer crux_flutter, proposed in Run 2026-10-22-0530:\n/m)
})

test("re-running an earlier Run's Save state never replaces a proposal a later Run queued", async () => {
  ws = makeWorkspace()
  const laterRun = '2026-10-22-0530-10'
  const laterMemory = `${newMemory}- Later: payments moved to v2.\n`
  reviewerMemoryChanges('review')
  ws.writeRepoList([])
  for (const [id, memory] of [
    [laterRun, laterMemory],
    [runId, newMemory],
  ]) {
    ws.prepareRun(id)
    ws.writeRepoState({ crux_flutter: { lastReviewed: sha(1) } })
    ws.writeRunFile(id, 'fetch/crux_flutter.json', changed('crux_flutter'))
    ws.writeRunFile(id, 'review/crux_flutter.json', reviewed('crux_flutter', memory))
    const result = await ws.agents('step', 'save-state', '--run', id)
    assert.equal(result.status, 0, result.stderr)
  }

  assert.match((await ws.agents('memory')).stdout, new RegExp(`^reviewer crux_flutter, proposed in Run ${laterRun}:\n`, 'm'))
})

test("a forced PM re-run's corrected Memory is applied, though the Run settled the PM's first proposal already", async () => {
  ws = makeWorkspace()
  ws.writeMemory('pm', 'notes', oldOpenItems)
  await saveStateAfterPm(newOpenItems, { memoryRead: oldOpenItems })
  const corrected = '- 2026-10-22: download the payments revamp PRD from Priya.\n'

  await saveStateAfterPm(corrected, { memoryRead: newOpenItems })

  assert.equal(ws.readMemory('pm', 'notes'), corrected)
  const { decidedAt, ...change } = JSON.parse(ws.readRunFile(runId, 'memory', 'pm', 'notes.json'))
  assert.deepEqual(change, { agent: 'pm', name: 'notes', decision: 'applied', proposed: corrected, before: newOpenItems, after: corrected })
})
