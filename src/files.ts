import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

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
export function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`)
  renameSync(`${file}.tmp`, file)
}
