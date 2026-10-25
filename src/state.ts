import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readJson, writeJson } from './files.ts'
import { stateDir } from './paths.ts'

/** What the Pipeline remembers about a Repo between Runs. */
export interface RepoState {
  /** The last commit on the production branch that has been reviewed, or the first Run's baseline. */
  lastReviewed: string
}

const repoStateFile = () => join(stateDir(), 'repos.json')

export function readRepoState(): Record<string, RepoState> {
  return existsSync(repoStateFile()) ? readJson(repoStateFile()) : {}
}

export function writeRepoState(state: Record<string, RepoState>): void {
  writeJson(repoStateFile(), state)
}

/** What the Pipeline remembers about Discord between Runs. */
export interface DiscordState {
  /** Where the last successful Discord read ended, so the next one starts there. */
  lastRead: string
}

const discordStateFile = () => join(stateDir(), 'discord.json')

export function readDiscordState(): DiscordState | null {
  return existsSync(discordStateFile()) ? readJson(discordStateFile()) : null
}

export function writeDiscordState(state: DiscordState): void {
  writeJson(discordStateFile(), state)
}

/** What the Pipeline remembers about one Repo's documentation between Runs. */
export interface DocsRepoState {
  /**
   * The last commit the Docs Step finished bringing the wiki up to, or, until it first finishes,
   * where it started. Kept apart from the last reviewed commit, so a Docs Step that fails is retried
   * on the same commits even once their review succeeded.
   */
  lastDocumented: string
}

const docsStateFile = () => join(stateDir(), 'docs.json')

export function readDocsState(): Record<string, DocsRepoState> {
  return existsSync(docsStateFile()) ? readJson(docsStateFile()) : {}
}

export function writeDocsState(state: Record<string, DocsRepoState>): void {
  writeJson(docsStateFile(), state)
}

const pmBacklogFile = () => join(stateDir(), 'pm-backlog.json')

/**
 * The Runs whose reviews, new commits and Discord messages no PM answer has covered yet, since
 * their PM failed, oldest first. The next PM is given them beside its own Run's.
 */
export function readPmBacklog(): string[] {
  return existsSync(pmBacklogFile()) ? readJson(pmBacklogFile()) : []
}

export function writePmBacklog(runs: string[]): void {
  writeJson(pmBacklogFile(), runs)
}

/** The Answer last applied to an item, by the item's id: when it was saved, and the Run that applied it. */
export interface AppliedAnswer {
  answer: string
  savedAt: string
  run: string
}

const answersStateFile = () => join(stateDir(), 'answers.json')

/** The Answers applied so far, so an Answers file saved before one of them can't undo it. */
export function readAnswersState(): Record<string, AppliedAnswer> {
  return existsSync(answersStateFile()) ? readJson(answersStateFile()) : {}
}

export function writeAnswersState(state: Record<string, AppliedAnswer>): void {
  writeJson(answersStateFile(), state)
}
