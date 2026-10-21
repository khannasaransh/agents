import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8'))
}

/** Writes through a temporary file, so a reader never sees half a file. */
export function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`)
  renameSync(`${file}.tmp`, file)
}
