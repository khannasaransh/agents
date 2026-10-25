// The PRD inbox: where PRD files wait for the Docs Agent, whether the Discord Step saved them or
// Saransh dropped them in by hand. The files waiting are those at its top level. The Docs Step moves
// each file it handled into done/, or into skipped/ when it isn't a PRD, so the inbox shows only
// what's still waiting.
import { existsSync, mkdirSync, readdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { freeName, readJson, writeJson } from './files.ts'
import { prdInboxDir } from './paths.ts'

/**
 * Where each file the Discord Step saved came from: the Discord message link and the attachment ID,
 * by the file's path in the inbox. That is its name while it waits, and done/<name> or
 * skipped/<name> once the Docs Step has moved it there. Files Saransh dropped in by hand have no entry.
 */
export type InboxSources = Record<string, { message: string; attachment: string }>

/** Where the Docs Step moves a file it handled: done/ for a PRD it turned into a PRD page, skipped/ for one that isn't a PRD. */
export type HandledArea = 'done' | 'skipped'

const sourcesFile = () => join(prdInboxDir(), 'sources.json')

export function readInboxSources(): InboxSources {
  return existsSync(sourcesFile()) ? readJson<InboxSources>(sourcesFile()) : {}
}

export function writeInboxSources(sources: InboxSources): void {
  writeJson(sourcesFile(), sources)
}

/** The files waiting in the inbox, by name: every file at its top level, but sources.json and hidden files such as .DS_Store. */
export function waitingFiles(): string[] {
  if (!existsSync(prdInboxDir())) return []
  return readdirSync(prdInboxDir())
    .filter((name) => name !== 'sources.json' && !name.startsWith('.') && statSync(join(prdInboxDir(), name)).isFile())
    .sort()
}

/**
 * Moves waiting files out of the inbox into done/ or skipped/, under a free name there. Each keeps
 * its sources.json entry, under its new path, so the Discord Step never saves its attachment again.
 * A file named twice, or no longer waiting, is moved once or not at all, so finishing an earlier
 * Run's moves is safe. sources.json is written after each move, so it never names a file that isn't
 * where it says.
 */
export function moveOut(files: { file: string; area: HandledArea }[]): void {
  const sources = readInboxSources()
  const waiting = new Set(waitingFiles())
  for (const { file, area } of files) {
    if (!waiting.delete(file)) continue
    const folder = join(prdInboxDir(), area)
    mkdirSync(folder, { recursive: true })
    const moved = `${area}/${freeName(folder, file)}`
    renameSync(join(prdInboxDir(), file), join(prdInboxDir(), moved))
    if (sources[file]) {
      sources[moved] = sources[file]
      delete sources[file]
      writeInboxSources(sources)
    }
    console.log(`Moved ${file} out of the PRD inbox to ${moved}`)
  }
}

/**
 * Gives each waiting file that Saransh moved back from done/ or skipped/, to have it tried again,
 * its sources.json entry back under its waiting name, so its PRD page still cites the Discord
 * message it came from. An entry is taken back only while its file is gone from where it names.
 */
export function reclaimMovedBack(): void {
  const sources = readInboxSources()
  let reclaimed = false
  for (const file of waitingFiles()) {
    if (sources[file]) continue
    const moved = (['done', 'skipped'] as const).map((area) => `${area}/${file}`).find((path) => sources[path] && !existsSync(join(prdInboxDir(), path)))
    if (!moved) continue
    sources[file] = sources[moved]
    delete sources[moved]
    reclaimed = true
    console.log(`${file} came back into the PRD inbox from ${moved}, with its source`)
  }
  if (reclaimed) writeInboxSources(sources)
}
