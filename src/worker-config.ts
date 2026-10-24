// The Workers' config: the Claude Code, Codex and Antigravity config Saransh uses, kept in this
// repo so the Workers behave the same on every machine. It is held a folder per Worker, laid out
// as in the home folder, with `{{home}}` and `{{root}}` standing for the paths that pointed at the
// machine it was captured from: its home folder and the folder holding the Team folders.
import { chmodSync, copyFileSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join, posix, relative, win32 } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { workerNames, type WorkerName } from './agent.ts'
import { readJson, writeJson, writeText } from './files.ts'
import { workerConfigDir } from './paths.ts'

/** The folders a placeholder stands for. */
type Place = 'home' | 'root'

/** The machine config is installed on: its home folder, the folder holding its Team folders, and its OS. */
export interface Layout extends Record<Place, string> {
  platform: NodeJS.Platform
}

/** What setup did with one file of the Workers' config, as the line it prints, and whether it's done. */
export interface InstalledFile {
  ok: boolean
  file: string
  line: string
}

/**
 * Files a Worker keeps its own state in beside its config, so setup puts in the config's top-level
 * keys and keeps the rest: Claude Code's MCP servers live in .claude.json, with its login and history.
 */
const mergedFiles = new Set(['.claude.json'])

/** A placeholder, with the rest of its path in forward slashes, and a separator that ends it. */
const placeholder = /\{\{(home|root)\}\}((?:\/[^/\\\s"'(),;\]]+)*)(\/?)/g

/**
 * Installs every file of the Workers' config into the home folder, with its paths made this
 * machine's. A file already there is copied beside itself, to `<name>.backup-<time>`, before it is
 * replaced, and left alone when it already holds the same config.
 */
export function installWorkerConfig(layout: Layout): InstalledFile[] {
  const time = new Date().toISOString().replace(/[:.]/g, '-')
  const installed: InstalledFile[] = []
  for (const worker of workerNames) {
    const folder = join(workerConfigDir(), worker)
    if (!existsSync(folder)) continue
    for (const entry of readdirSync(folder, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue
      const name = relative(folder, join(entry.parentPath, entry.name))
      const file = join(layout.home, name)
      try {
        // Git may check the repo out with Windows line endings, which bash can't run.
        const text = renderWorkerConfig(name, readFileSync(join(entry.parentPath, entry.name), 'utf8').replaceAll('\r\n', '\n'), layout)
        installed.push({ ok: true, file, line: install(file, text, { backup: `${file}.backup-${time}`, merge: mergedFiles.has(name) }) })
      } catch (error) {
        installed.push({ ok: false, file, line: `failed to install: ${(error as Error).message}` })
      }
    }
  }
  return installed
}

/**
 * Writes one file of the config, backing up the one it replaces, and says what it did. A merged
 * file gets the config's top-level keys and keeps the others it had. A shell script is made
 * executable, since the Worker runs it as a command.
 */
function install(file: string, text: string, { backup, merge }: { backup: string; merge: boolean }): string {
  const existed = existsSync(file)
  if (existed) {
    const old = readFileSync(file, 'utf8')
    if (merge) text = `${JSON.stringify({ ...JSON.parse(old), ...JSON.parse(text) }, null, 2)}\n`
    if (sameConfig(file, old, text)) return 'already as in this repo'
    copyFileSync(file, backup)
  }
  writeText(file, text)
  if (file.endsWith('.sh')) chmodSync(file, 0o755)
  return existed ? `replaced; the old one is in ${backup}` : 'installed'
}

/** Whether two versions of a file hold the same config, however JSON is spaced. */
function sameConfig(file: string, a: string, b: string): boolean {
  if (!file.endsWith('.json')) return a.replaceAll('\r\n', '\n') === b
  try {
    return isDeepStrictEqual(JSON.parse(a), JSON.parse(b))
  } catch {
    return false
  }
}

/**
 * A file of the Workers' config with its placeholders made the paths of `layout`, written the way
 * the file's kind needs them. JSON and shell scripts get forward slashes on Windows too, since
 * Claude Code runs its status line and hooks through bash there, which takes a backslash as an
 * escape. TOML gets Windows' own backslashes, escaped in a basic string, since Codex keys the
 * folders it trusts by them.
 */
export function renderWorkerConfig(file: string, text: string, layout: Layout): string {
  const path = layout.platform === 'win32' ? win32 : posix
  const native = (name: Place, tail: string, end: string) => path.join(layout[name], ...tail.split('/').filter(Boolean)) + (end && path.sep)
  const forward = (name: Place, tail: string, end: string) => native(name, tail, end).replaceAll('\\', '/')
  if (file.endsWith('.json')) {
    const value = mapJsonStrings(JSON.parse(text), (string) => string.replace(placeholder, (_, name, tail, end) => forward(name, tail, end)))
    return `${JSON.stringify(value, null, 2)}\n`
  }
  if (file.endsWith('.toml')) {
    return text
      .split('\n')
      .map((line) =>
        line.replace(placeholder, (_, name, tail, end, offset: number) => {
          const nativePath = native(name, tail, end)
          return inBasicString(line, offset) ? nativePath.replaceAll('\\', '\\\\') : nativePath
        }),
      )
      .join('\n')
  }
  if (file.endsWith('.sh')) return text.replace(placeholder, (_, name, tail, end) => forward(name, tail, end))
  return text.replace(placeholder, (_, name, tail, end) => native(name, tail, end))
}

/** A JSON value with every string in it, keys too, passed through `map`. */
function mapJsonStrings(value: unknown, map: (string: string) => string): unknown {
  if (typeof value === 'string') return map(value)
  if (Array.isArray(value)) return value.map((item) => mapJsonStrings(item, map))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [map(key), mapJsonStrings(item, map)]))
  return value
}

/** Whether `index` in a line of TOML falls inside a basic ("double-quoted") string, where a backslash escapes. */
function inBasicString(line: string, index: number): boolean {
  let quote: '"' | "'" | null = null
  for (let i = 0; i < index; i++) {
    const char = line[i]
    if (quote === '"' && char === '\\') i++
    else if (quote && char === quote) quote = null
    else if (!quote && (char === '"' || char === "'")) quote = char
    else if (!quote && char === '#') return false
  }
  return quote === '"'
}

/** A secret the Workers' config needs, which capture leaves out, so setup lists it to set by hand. */
export interface Secret {
  worker: WorkerName
  /** The config file, by its path in the home folder. */
  file: string
  /** The setting that held it, as a dotted path of keys. */
  setting: string
}

/** The files each Worker's config is captured from, by their paths in the home folder, in forward slashes. */
const capturedFiles: Record<WorkerName, string[]> = {
  'claude-code': ['.claude/settings.json', '.claude/statusline.sh', '.claude.json'],
  codex: ['.codex/config.toml', '.codex/AGENTS.md'],
  antigravity: ['.gemini/antigravity-cli/settings.json', '.gemini/antigravity-cli/keybindings.json', '.gemini/config/mcp_config.json'],
}

/** The name of a setting that holds a secret: an API key, token, password or the like. */
const secretName = /(token|secret|password|passwd|api[-_]?key|authorization|cookie|credentials?)$/i

/**
 * Text shaped like a secret, wherever it sits: the API keys and tokens of OpenAI, Anthropic, GitHub,
 * Slack, AWS and Google, and a bearer token. Capture refuses a file still holding one.
 */
const secretValue = /\b(sk-[\w-]{16,}|gh[pousr]_\w{20,}|github_pat_\w{20,}|xox[abprs]-[\w-]{10,}|AKIA[0-9A-Z]{16}|AIza[\w-]{30,}|Bearer\s+[\w.~+/=-]{16,})/

/**
 * Copies this machine's Workers' config into the repo, replacing what was there. The paths that
 * point at this machine become placeholders, secrets are left out and listed in secrets.json, and
 * the state a Worker keeps beside its config stays behind, as does an empty file. It reads it all
 * before changing the repo, so a file it can't capture, such as one with a secret where capture
 * can't leave it out, leaves the repo as it was. Returns the files it wrote, by their paths in the
 * home folder, and the secrets it left out.
 */
export function captureWorkerConfig(places: Record<Place, string>): { files: string[]; secrets: Secret[] } {
  const captured: { worker: WorkerName; file: string; text: string }[] = []
  const secrets: Secret[] = []
  for (const worker of workerNames) {
    for (const file of capturedFiles[worker]) {
      const source = join(places.home, file)
      if (!existsSync(source)) continue
      const text = readFileSync(source, 'utf8').replaceAll('\r\n', '\n')
      if (!text.trim()) continue
      const secret = (setting: string) => secrets.push({ worker, file, setting })
      let config: string | null
      try {
        config = file.endsWith('.json') ? captureJson(file, JSON.parse(text), places, secret) : portablePaths(captureText(file, text, secret), places)
      } catch (error) {
        throw new Error(`Can't capture ${source}: ${(error as Error).message}`)
      }
      if (config === null) continue
      const leftover = secretValue.exec(config)
      if (leftover) {
        throw new Error(`Can't capture ${source}: it holds what looks like a secret (${leftover[1].slice(0, 6)}…) in a place capture can't leave out. Move it into a setting named for it, or an environment variable, and capture again`)
      }
      captured.push({ worker, file, text: config })
    }
  }
  const folder = workerConfigDir()
  for (const worker of workerNames) rmSync(join(folder, worker), { recursive: true, force: true })
  for (const { worker, file, text } of captured) writeText(join(folder, worker, file), text)
  writeJson(join(folder, 'secrets.json'), secrets)
  return { files: captured.map(({ file }) => file), secrets }
}

/**
 * A JSON config file as captured, or null when it holds no config. Claude Code's settings also name
 * the plugin marketplaces it knows, so another machine can install the plugins they enable, and only
 * the MCP servers are taken from .claude.json, which otherwise holds Claude Code's login and history.
 */
function captureJson(file: string, value: Record<string, unknown>, places: Record<Place, string>, secret: (setting: string) => void): string | null {
  if (file === '.claude.json') {
    if (!value.mcpServers || !Object.keys(value.mcpServers).length) return null
    value = { mcpServers: value.mcpServers }
  }
  if (file === '.claude/settings.json') {
    const known = join(places.home, '.claude', 'plugins', 'known_marketplaces.json')
    const marketplaces = existsSync(known) ? readJson<Record<string, { source: unknown }>>(known) : {}
    const extra = Object.fromEntries(Object.entries(marketplaces).map(([name, { source }]) => [name, { source }]))
    if (Object.keys(extra).length) value = { ...value, extraKnownMarketplaces: { ...extra, ...(value.extraKnownMarketplaces as object) } }
  }
  const portable = mapJsonStrings(withoutSecrets(value, [], secret), (string) => portablePaths(string, places))
  return `${JSON.stringify(portable, null, 2)}\n`
}

/** A JSON value without the settings that hold secrets, each of which is passed to `secret`. */
function withoutSecrets(value: unknown, keys: string[], secret: (setting: string) => void): unknown {
  if (Array.isArray(value)) return value.map((item, i) => withoutSecrets(item, [...keys, String(i)], secret))
  if (!value || typeof value !== 'object') return value
  const kept: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (secretName.test(key) && typeof item === 'string' && item) secret([...keys, key].join('.'))
    else kept[key] = withoutSecrets(item, [...keys, key], secret)
  }
  return kept
}

/**
 * Entries the Codex app writes into config.toml on every start, pointing at its own runtime, which
 * differs by machine and app version: its notifier, its Node REPL and its bundled marketplaces.
 */
const codexAppKeys = new Set(['notify'])
const codexAppTables = /^(mcp_servers\.node_repl|marketplaces\.openai-bundled|marketplaces\.openai-primary-runtime)(\.|$)/

/**
 * A text config file as captured. In TOML, a setting holding a secret is left out, or emptied when
 * it sits in an inline table, and Codex's app-written entries are left out.
 */
function captureText(file: string, text: string, secret: (setting: string) => void): string {
  if (!file.endsWith('.toml')) return text
  const codex = file === '.codex/config.toml'
  const kept: string[] = []
  let table = ''
  let skippedDepth = 0
  for (const line of text.split('\n')) {
    // The rest of an array a left-out key opened on an earlier line.
    if (skippedDepth > 0) {
      skippedDepth += bracketDepth(line)
      continue
    }
    const header = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/.exec(line)
    if (header) table = header[1]
    if (codex && codexAppTables.test(table)) continue
    const key = /^\s*(["']?)([\w.-]+)\1\s*=/.exec(line)
    if (key && !table && codex && codexAppKeys.has(key[2])) {
      skippedDepth = bracketDepth(line)
      continue
    }
    if (key && secretName.test(key[2]) && /=\s*["']./.test(line)) {
      secret([table, key[2]].filter(Boolean).join('.'))
      continue
    }
    kept.push(
      line.replace(/(?<=[{,]\s*)(["']?)([\w.-]+)\1(\s*=\s*)("(?:[^"\\]|\\.)*"|'[^']*')/g, (pair, quote, name, equals, value) => {
        if (!secretName.test(name) || value.length <= 2) return pair
        secret([table, key?.[2], name].filter(Boolean).join('.'))
        return `${quote}${name}${quote}${equals}""`
      }),
    )
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n')
}

/** How many more brackets a line of TOML opens than it closes, outside strings and comments. */
function bracketDepth(line: string): number {
  const code = line.replace(/"(?:[^"\\]|\\.)*"|'[^']*'|#.*$/g, '')
  return (code.match(/\[/g)?.length ?? 0) - (code.match(/\]/g)?.length ?? 0)
}

/**
 * Text with each path inside this machine's root or home folder made a placeholder, with the rest
 * of the path in forward slashes, whichever separators, escaping or letter case it was written in.
 * The longer of the two goes first, since on a Mac the root is inside the home folder.
 */
export function portablePaths(text: string, places: Record<Place, string>): string {
  const byLength = Object.entries(places).sort(([, a], [, b]) => b.length - a.length)
  for (const [name, place] of byLength) {
    const prefix = place
      .split(/[\\/]+/)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('[\\\\/]+')
    const path = new RegExp(`(?<![\\w.-])${prefix}((?:[\\\\/]+[^\\\\/\\s"'(),;\\]]+)*)([\\\\/]*)(?=$|[\\s"'(),;\\]])`, 'gi')
    text = text.replace(path, (_, tail: string, end: string) => {
      const parts = tail.split(/[\\/]+/).filter(Boolean)
      return `{{${name}}}${parts.map((part) => `/${part}`).join('')}${end ? '/' : ''}`
    })
  }
  return text
}

/** The secrets the Workers' config in the repo needs, which capture left out. */
export function workerConfigSecrets(): Secret[] {
  const file = join(workerConfigDir(), 'secrets.json')
  return existsSync(file) ? readJson<Secret[]>(file) : []
}
