import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readJson, readJsonFiles, writeJson, writeText } from './files.ts'
import { memoryDir, runDir, stateDir } from './paths.ts'

/** The Markdown file holding one of an Agent's Memory notes, such as the Reviewer's for one Repo. */
export function memoryFile(agent: string, name: string): string {
  return join(memoryDir(), agent, `${name}.md`)
}

/** The Memory as it is now, with any edit Saransh made by hand; empty when there is none yet. */
export function readMemory(agent: string, name: string): string {
  const file = memoryFile(agent, name)
  return existsSync(file) ? readFileSync(file, 'utf8') : ''
}

/** A new version of one Memory file that an Agent proposed in a Run, waiting for Saransh to accept or reject. */
export interface MemoryProposal {
  agent: string
  name: string
  run: string
  /** The whole Memory file as proposed. */
  memory: string
  /**
   * The Memory the Agent read, which the proposal builds on. Once the Memory has changed since, by
   * Saransh or by another Run, applying the proposal would undo that change. A proposal from before
   * proposals recorded it has none.
   */
  base?: string
}

/** Whether the Memory is still as the Agent read it when it made this proposal. */
export function buildsOnCurrent({ agent, name, base }: MemoryProposal): boolean {
  return base === undefined || readMemory(agent, name) === base
}

/** Orders Run IDs by when they started, `2026-10-22-0530-10` after `2026-10-22-0530-9`. */
export const byRunStart = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true })

const proposalsDir = () => join(stateDir(), 'memory-proposals')
const proposalFile = (agent: string, name: string) => join(proposalsDir(), agent, `${name}.json`)

/**
 * Queues a proposal for Saransh, replacing one from the same or an earlier Run for the same Memory
 * file. Returns false, queuing nothing, when one from a later Run waits already, so re-running an
 * older Run's Save state never replaces a newer proposal.
 */
export function queueProposal(proposal: MemoryProposal): boolean {
  const file = proposalFile(proposal.agent, proposal.name)
  if (existsSync(file) && byRunStart(readJson<MemoryProposal>(file).run, proposal.run) > 0) return false
  writeJson(file, proposal)
  return true
}

/** Every proposal waiting for Saransh, by Agent and then name. */
export function pendingProposals(): MemoryProposal[] {
  if (!existsSync(proposalsDir())) return []
  return readdirSync(proposalsDir())
    .sort()
    .flatMap((agent) => readJsonFiles<MemoryProposal>(join(proposalsDir(), agent)))
}

/** Applied: by Save state, without waiting for Saransh. Accepted or rejected: by Saransh. */
export type MemoryDecision = 'applied' | 'accepted' | 'rejected'

/**
 * Makes the proposal the Memory the next Run reads, unless it was rejected, and records the
 * decision in the Run that proposed it, with the Memory proposed, before and after.
 */
export function settleProposal(proposal: MemoryProposal, decision: MemoryDecision): void {
  const { agent, name } = proposal
  const before = readMemory(agent, name)
  if (decision !== 'rejected') writeText(memoryFile(agent, name), proposal.memory)
  const after = readMemory(agent, name)
  writeJson(decisionFile(proposal), { agent, name, decision, decidedAt: new Date().toISOString(), proposed: proposal.memory, before, after })
}

/**
 * Whether the Run that proposed this change has recorded what became of it. A different proposal
 * for the same Memory in that Run, such as a forced re-run's, is a new one, waiting for a decision.
 * A decision from before decisions recorded what they settled counts for any proposal.
 */
export function isSettled(proposal: MemoryProposal): boolean {
  if (!existsSync(decisionFile(proposal))) return false
  const { proposed } = readJson<{ proposed?: string }>(decisionFile(proposal))
  return proposed === undefined || proposed === proposal.memory
}

const decisionFile = ({ run, agent, name }: MemoryProposal) => join(runDir(run), 'memory', agent, `${name}.json`)

/**
 * Saransh's decision on the proposal waiting for this Memory file, which then stops waiting. Call it
 * holding the Run lock, so no Save state queues a proposal meanwhile; and a proposal that replaced
 * this one all the same still waits.
 */
export function decideProposal(agent: string, name: string, decision: 'accepted' | 'rejected'): MemoryProposal {
  const file = proposalFile(agent, name)
  if (!existsSync(file)) throw new Error(`No Memory change for ${agent} ${name} is waiting for you`)
  const text = readFileSync(file, 'utf8')
  const proposal: MemoryProposal = JSON.parse(text)
  settleProposal(proposal, decision)
  if (existsSync(file) && readFileSync(file, 'utf8') === text) rmSync(file)
  return proposal
}

/** The proposal as a unified diff against the Memory Saransh has now. */
export function proposalDiff({ agent, name, memory }: MemoryProposal): string {
  const temp = mkdtempSync(join(tmpdir(), 'agents-memory-'))
  try {
    const proposed = join(temp, `${name}.md`)
    writeFileSync(proposed, memory)
    const current = existsSync(memoryFile(agent, name)) ? memoryFile(agent, name) : '/dev/null'
    const { stdout } = spawnSync('git', ['diff', '--no-index', '--no-color', '--no-ext-diff', '--', current, proposed], { encoding: 'utf8', windowsHide: true })
    const hunks = stdout.indexOf('\n@@')
    return hunks < 0 ? '(no change)\n' : stdout.slice(hunks + 1)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}
