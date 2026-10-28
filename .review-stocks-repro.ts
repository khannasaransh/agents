import { makeWorkspace, pdExamples } from './test/helpers.ts'
import { readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
const id = '2026-10-27-0930'
const example = (name: string) => JSON.parse(readFileSync(join(pdExamples, name), 'utf8'))
const answer = { diagnosis: 'review diagnosis', fix: 'review fix', evidence: [], corrections: [] }
{
  const ws = makeWorkspace()
  try {
    ws.prepareRun(id, { pipeline: 'stocks', steps: [{ name: 'lake', status: 'pending' }] })
    ws.setPd({ 'clear-refresh': { example: 'clear-refresh.nothing.json' }, daily: {}, status: [{ exitCode: 1, stderr: 'database locked' }, { example: 'status.clean.json' }] })
    const first = await ws.agents('step', 'lake', '--run', id)
    const second = await ws.agents('step', 'lake', '--run', id)
    console.log(JSON.stringify({ case: 'lake-status-retry', first: first.status, retry: second.status, statusExists: ws.runFiles(id, 'lake').includes('status.json'), calls: ws.pdCalls().map(c => c.args) }))
  } finally { ws.cleanup() }
}
{
  const ws = makeWorkspace()
  try {
    const ash = join(ws.homeDir, 'ash'); mkdirSync(ash); ws.writeEnvFile(`ASH_NEW_FOLDER=${ash}\n`)
    ws.prepareRun(id, { pipeline: 'stocks', steps: [{ name: 'lake', status: 'succeeded' }, { name: 'health', status: 'pending' }, { name: 'brief', status: 'pending' }] })
    ws.writeRunFile(id, 'run.json', { ...ws.readRun(id), worker: 'codex' })
    ws.writeRunFile(id, 'lake/status.json', example('status.healthy.json'))
    ws.setWorkerCli('claude', { stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 1, result: JSON.stringify(answer), structured_output: answer }) })
    const ran = await ws.agents('step', 'health', '--run', id)
    console.log(JSON.stringify({ case: 'health-worker-override', exit: ran.status, requested: 'codex', claudeCalls: ws.workerCliCalls('claude').length, codexCalls: ws.workerCliCalls('codex').length }))
    const stale = example('status.healthy.json')
    stale.corrections[0].why = 'STALE_REVIEW_MARKER'
    ws.writeRunFile(id, 'health/status.json', stale)
    ws.writeRunFile(id, 'lake/status.json', example('status.clean.json'))
    await ws.agents('step', 'health', '--run', id)
    const brief = await ws.agents('step', 'brief', '--run', id)
    console.log(JSON.stringify({ case: 'stale-health-status', briefExit: brief.status, latestLakeCorrections: example('status.clean.json').corrections.length, staleCorrectionRendered: ws.readRunFile(id, 'brief.html').includes('STALE_REVIEW_MARKER') }))
    const run = ws.readRun(id)
    run.steps.find(s => s.name === 'health')!.status = 'failed'
    ws.writeRunFile(id, 'run.json', run)
    ws.writeRunFile(id, 'health.json', { ...answer, diagnosis: 'RECORDED_DIAGNOSIS_MARKER', status: 'diagnosed', why: [], inputs: 'test', proposals: { status: 'failed', error: 'PROPOSAL_ERROR_MARKER' } })
    await ws.agents('step', 'brief', '--run', id, '--force')
    const failedBrief = ws.readRunFile(id, 'brief.html')
    console.log(JSON.stringify({ case: 'proposal-failure-diagnosis', diagnosisVisible: failedBrief.includes('RECORDED_DIAGNOSIS_MARKER'), proposalErrorVisible: failedBrief.includes('PROPOSAL_ERROR_MARKER'), incorrectlySaysNoDiagnosis: failedBrief.includes('failed before it recorded a diagnosis') }))
  } finally { ws.cleanup() }
}
