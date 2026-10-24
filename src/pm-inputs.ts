// What the PM Agent reads from Runs: their reviews, new commits and Discord messages. Besides the
// Run it runs in, it reads those of earlier Runs whose PM failed, which Save state keeps in the PM
// backlog until a PM answer covers them, so nothing they held is lost to the PM. An answer records
// what it was given as a fingerprint, so a Step and the Brief can tell when an earlier Step was
// re-run since and the answer no longer covers what the Run holds.
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readJson, readJsonFiles } from './files.ts'
import { runDir } from './paths.ts'
import type { DiscordMessage, DiscordRead } from '../steps/discord.ts'
import type { FetchResult } from '../steps/fetch.ts'
import type { ReviewResult } from '../steps/review.ts'

type Reviewed = Extract<ReviewResult, { status: 'reviewed' }>

/** A review as the PM Agent is given it: without the Memory the Reviewer read and proposed, which is the Reviewer's own. */
export type PmReview = Exclude<ReviewResult, Reviewed> | Omit<Reviewed, 'memory' | 'memoryRead'>

/** The new commits on one Repo in one Run, as the PM Agent is given them. */
export interface PmCommits {
  repo: string
  team: FetchResult['team']
  branch: string
  commits: { sha: string; author: string; subject: string }[]
}

/** What the PM Agent reads from Runs, oldest Run first. */
export interface PmRunInputs {
  reviews: PmReview[]
  commits: PmCommits[]
  /** The Discord messages read, oldest first, or null when no Run read Discord. */
  discord: DiscordMessage[] | null
}

/** What one Run holds for the PM. A review counts only when it covers the commits that Run's Fetch found, so not one from before Fetch was re-run. */
function inputsOf(runId: string): PmRunInputs {
  const runFolder = runDir(runId)
  const results = readJsonFiles<FetchResult>(join(runFolder, 'fetch'))
  const covers = (review: ReviewResult) =>
    results.some((r) => r.repo === review.repo && r.status === 'new-commits' && r.previous === review.from && r.head === review.to)
  const reviews = readJsonFiles<ReviewResult>(join(runFolder, 'review'))
    .filter(covers)
    .map((review): PmReview => {
      if (review.status !== 'reviewed') return review
      const { memory, memoryRead, ...reviewed } = review
      return reviewed
    })
  const commits = results.flatMap((r) =>
    r.status === 'new-commits' ? [{ repo: r.repo, team: r.team, branch: r.branch, commits: r.commits.map(({ sha, author, subject }) => ({ sha, author, subject })) }] : [],
  )
  const discordFile = join(runFolder, 'discord.json')
  const discord = existsSync(discordFile) ? readJson<DiscordRead>(discordFile).messages : null
  return { reviews, commits, discord }
}

/** What the PM Agent reads from these Runs, together. */
export function pmRunInputs(runIds: string[]): PmRunInputs {
  const each = runIds.map(inputsOf)
  const read = each.flatMap((inputs) => (inputs.discord ? [inputs.discord] : []))
  return {
    reviews: each.flatMap((inputs) => inputs.reviews),
    commits: each.flatMap((inputs) => inputs.commits),
    discord: read.length ? read.flat() : null,
  }
}

/** Whether a Run holds anything for the PM. */
export function holdsPmInputs(runId: string): boolean {
  const { reviews, commits, discord } = inputsOf(runId)
  return reviews.length > 0 || commits.length > 0 || (discord?.length ?? 0) > 0
}

export function fingerprint(inputs: PmRunInputs): string {
  return createHash('sha256').update(JSON.stringify(inputs)).digest('hex')
}

/**
 * Whether a PM answer still covers what its Runs hold. An answer from before answers recorded their
 * Runs and fingerprint is taken as it is.
 */
export function coversItsRuns({ runs, inputs }: { runs?: string[]; inputs?: string }): boolean {
  return !runs || !inputs || fingerprint(pmRunInputs(runs)) === inputs
}
