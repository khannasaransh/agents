import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { agentsRoot } from './paths.ts'

/** In the order the Brief lists them. */
export const teams = ['flutter', 'android', 'ios', 'backend', 'data', 'frontend', 'other'] as const
export type Team = (typeof teams)[number]

export interface Repo {
  name: string
  team: Team
  remote: string
  /** The local clone on this Mac. `~` stands for the home folder. */
  folder: string
  /** The production branch: the one that ships, whatever the clone has checked out. */
  branch: string
}

/** Loads the Repo list (repos.ts, or the file named by AGENTS_REPOS_FILE). */
export async function loadRepos(): Promise<Repo[]> {
  const file = process.env.AGENTS_REPOS_FILE ?? join(agentsRoot, 'repos.ts')
  const repos: Repo[] = (await import(pathToFileURL(file).href)).default
  return repos.map((repo) => ({ ...repo, folder: repo.folder.replace(/^~(?=\/|$)/, homedir()) }))
}
