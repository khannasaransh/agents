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
