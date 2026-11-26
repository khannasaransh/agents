// The Repo list on the Windows machine: repos.ts, with each Repo's folder moved from the Mac's
// ~/Saransh/github/<team>/<repo> to D:/Saransh/inshorts/github/<team>/<repo>, where this machine's
// clones are. It derives from repos.ts rather than copying it, so a regenerated repos.ts carries over.
// This machine reads it through AGENTS_REPOS_FILE=repos.windows.ts in .env; the Mac never does.
import type { Repo } from './src/repos.ts'
import repos from './repos.ts'

const macFolders = '~/Saransh/github/'
const windowsFolders = 'D:/Saransh/inshorts/github/'

const windowsRepos: Repo[] = repos.map((repo) => {
  if (!repo.folder.startsWith(macFolders)) throw new Error(`${repo.name}'s folder ${repo.folder} isn't under ${macFolders}, so it has no Windows folder`)
  return { ...repo, folder: windowsFolders + repo.folder.slice(macFolders.length) }
})

export default windowsRepos
