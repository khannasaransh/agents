// Refuses to go on under a Node older than package.json's engines ask for, naming the version needed.
// The CLI imports this first, so it runs before anything that needs the newer Node.
import { readFileSync } from 'node:fs'

/** Why `version` of Node can't run this repo, whose engines field asks for `engines`, or null when it can. */
export function nodeRefusal(version: string, engines: string): string | null {
  const needed = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(engines)
  if (!needed) return null
  const [have, want] = [version.replace(/^v/, '').split('.').map(Number), needed.slice(1).map((part) => Number(part ?? 0))]
  for (let i = 0; i < 3; i++) {
    if (have[i] > want[i]) return null
    if (have[i] < want[i]) return `agents needs Node ${want.join('.').replace(/(\.0)+$/, '')} or later; this is Node ${version.replace(/^v/, '')}`
  }
  return null
}

const { engines } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const refusal = nodeRefusal(process.versions.node, engines.node)
if (refusal) {
  console.error(refusal)
  process.exit(1)
}
