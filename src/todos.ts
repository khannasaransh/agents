import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { readJson, writeJson } from './files.ts'

const todosDir = (runFolder: string) => join(runFolder, 'todos')

/**
 * Records the To-dos a Step raises for Saransh, as todos/<step>.json in the Run folder, replacing
 * those it raised before: a Step run again raises only what is still to do.
 */
export function writeTodos(runFolder: string, step: string, todos: string[]): void {
  writeJson(join(todosDir(runFolder), `${step}.json`), todos)
}

/** Every To-do the Run's Steps raised, by Step name, for the Brief. */
export function readTodos(runFolder: string): { step: string; todo: string }[] {
  if (!existsSync(todosDir(runFolder))) return []
  return readdirSync(todosDir(runFolder))
    .filter((file) => file.endsWith('.json'))
    .sort((a, b) => a.localeCompare(b))
    .flatMap((file) => readJson<string[]>(join(todosDir(runFolder), file)).map((todo) => ({ step: file.slice(0, -'.json'.length), todo })))
}
