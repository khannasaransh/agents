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
}

const proposalsDir = () => join(stateDir(), 'memory-proposals')
const proposalFile = (agent: string, name: string) => join(proposalsDir(), agent, `${name}.json`)

/** Queues a proposal for Saransh, replacing any older one for the same Memory file. */
export function queueProposal(proposal: MemoryProposal): void {
  writeJson(proposalFile(proposal.agent, proposal.name), proposal)
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
 * decision in the Run that proposed it, with the Memory before and after.
 */
export function settleProposal(proposal: MemoryProposal, decision: MemoryDecision): void {
  const { agent, name } = proposal
  const before = readMemory(agent, name)
  if (decision !== 'rejected') writeText(memoryFile(agent, name), proposal.memory)
  const after = readMemory(agent, name)
  writeJson(decisionFile(proposal), { agent, name, decision, decidedAt: new Date().toISOString(), before, after })
}

/** Whether the Run that proposed this change has recorded what became of it. */
export function isSettled(proposal: MemoryProposal): boolean {
  return existsSync(decisionFile(proposal))
}

const decisionFile = ({ run, agent, name }: MemoryProposal) => join(runDir(run), 'memory', agent, `${name}.json`)

/** Saransh's decision on the proposal waiting for this Memory file, which then stops waiting. */
export function decideProposal(agent: string, name: string, decision: 'accepted' | 'rejected'): MemoryProposal {
  const file = proposalFile(agent, name)
  if (!existsSync(file)) throw new Error(`No Memory change for ${agent} ${name} is waiting for you`)
  const proposal = readJson<MemoryProposal>(file)
  settleProposal(proposal, decision)
  rmSync(file)
  return proposal
}

/** The proposal as a unified diff against the Memory Saransh has now. */
export function proposalDiff({ agent, name, memory }: MemoryProposal): string {
  const temp = mkdtempSync(join(tmpdir(), 'agents-memory-'))
  try {
    const proposed = join(temp, `${name}.md`)
    writeFileSync(proposed, memory)
    const current = existsSync(memoryFile(agent, name)) ? memoryFile(agent, name) : '/dev/null'
    const { stdout } = spawnSync('git', ['diff', '--no-index', '--no-color', '--no-ext-diff', '--', current, proposed], { encoding: 'utf8' })
    const hunks = stdout.indexOf('\n@@')
    return hunks < 0 ? '(no change)\n' : stdout.slice(hunks + 1)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}
