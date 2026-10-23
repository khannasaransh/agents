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
