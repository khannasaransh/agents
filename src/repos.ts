import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { agentsRoot } from './paths.ts'

/** In the order the Brief lists them. */
export const teams = ['flutter', 'android', 'ios', 'backend', 'data', 'ai', 'frontend', 'other'] as const
export type Team = (typeof teams)[number]

/**
 * The Codebases, as the org wiki's glossary names them: the repos built and run together to serve
 * one or more Products. Shared holds repos several Codebases use, and company tools.
 */
export const codebases = ['Inshorts', 'Public', 'InPix', 'TangyTV', 'AstroHeal', 'InKredible', 'Aurapay', 'Shared'] as const
export type Codebase = (typeof codebases)[number]

export interface Repo {
  name: string
  team: Team
  /** The Codebase the Repo belongs to. */
  codebase: Codebase
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
