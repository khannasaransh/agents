import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, parse } from 'node:path'

export function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8'))
}

/** Reads every JSON file in a folder, such as the per-Repo results a Step wrote, in file name order. */
export function readJsonFiles<T>(folder: string): T[] {
  if (!existsSync(folder)) return []
  return readdirSync(folder)
    .filter((file) => file.endsWith('.json'))
    .sort((a, b) => a.localeCompare(b))
    .map((file) => readJson<T>(join(folder, file)))
}

/** Writes through a temporary file, so a reader never sees half a file. */
export function writeText(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(`${file}.tmp`, text)
  renameSync(`${file}.tmp`, file)
}

export function writeJson(file: string, value: unknown): void {
  writeText(file, `${JSON.stringify(value, null, 2)}\n`)
}

/** `filename`, or when `folder` holds a file by that name, the first free `name (n).ext`. */
export function freeName(folder: string, filename: string): string {
  const { name, ext } = parse(filename)
  let free = filename
  for (let n = 2; existsSync(join(folder, free)); n++) free = `${name} (${n})${ext}`
  return free
}

/**
 * Moves a file into `folder`, made if need be, under a free name there, and returns its new path. It
 * copies the file and deletes it when the folder is on another drive, as Downloads may be.
 */
export function moveInto(file: string, folder: string): string {
  mkdirSync(folder, { recursive: true })
  const moved = join(folder, freeName(folder, basename(file)))
  try {
    renameSync(file, moved)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
    copyFileSync(file, moved)
    rmSync(file)
  }
  return moved
}
