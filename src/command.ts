// Finds the program a command names, as a shell would, so it can start without one. On Windows that
// means PATH with PATHEXT's extensions, and npm's .cmd shims, which only cmd.exe runs: instead, the
// script a shim hands to Node is started with Node directly.
import { existsSync, readFileSync } from 'node:fs'
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path'

const windows = process.platform === 'win32'

/** The program to start for `command` with `args`, run in `cwd`, and the arguments to give it. */
export function commandLine(command: string, args: string[], { env = process.env, cwd = process.cwd() }: { env?: NodeJS.ProcessEnv; cwd?: string } = {}): { file: string; args: string[] } {
  if (!windows) return { file: command, args }
  const file = findOnPath(command, { env, cwd })
  if (!file) return { file: command, args }
  if (!/\.(cmd|bat)$/i.test(file)) return { file, args }
  const script = npmShimScript(file)
  if (!script) throw new Error(`${file} only runs through cmd.exe, and the Pipeline starts nothing through a shell`)
  const node = join(dirname(file), 'node.exe')
  return { file: existsSync(node) ? node : process.execPath, args: [script, ...args] }
}

/**
 * The file a command names, as a shell finds it: itself when it is a path (from `cwd` when relative),
 * else the first match on PATH. On Windows it takes only the PATHEXT extensions, so it skips the bash
 * scripts npm installs beside its .cmd shims.
 */
export function findOnPath(command: string, { env = process.env, cwd = process.cwd() }: { env?: NodeJS.ProcessEnv; cwd?: string } = {}): string | null {
  // Windows names are case-insensitive, and a copied environment keeps whichever spelling it had, such as Path.
  const variable = (name: string) => Object.entries(env).find(([key]) => key.toUpperCase() === name)?.[1]
  const extensions = windows ? (variable('PATHEXT') ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map((ext) => ext.toLowerCase()) : ['']
  const names = windows && /\.[^\\/]+$/.test(command) ? [command, ...extensions.map((ext) => command + ext)] : extensions.map((ext) => command + ext)
  const path = /[\\/]/.test(command)
  const dirs = path ? [isAbsolute(command) ? '' : cwd] : (variable('PATH') ?? '').split(delimiter).filter(Boolean)
  for (const dir of dirs) for (const name of names) if (existsSync(path ? resolve(dir, name) : join(dir, name))) return path ? resolve(dir, name) : join(dir, name)
  return null
}

/** The Node script an npm .cmd shim runs, or null when the file isn't one. */
function npmShimScript(shim: string): string | null {
  const text = readFileSync(shim, 'utf8')
  const match = /"%_prog%"\s+"%dp0%\\([^"]+)"\s+%\*/.exec(text)
  if (!match || !/SET "_prog=node"/i.test(text)) return null
  return join(dirname(shim), match[1])
}
