import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import { commandLine } from './command.ts'
import { killAll, killTree, processTree } from './process-tree.ts'
import { recordProcess } from './processes.ts'

const windows = process.platform === 'win32'

/** How a process ended. */
export interface ProcessResult {
  code: number | null
  stdout: string
  stderr: string
  /** It ran past its timeout and was ended. */
  timedOut: boolean
}

/** How long a timed-out process gets to stop what it started before everything left is killed. */
const graceMs = 5000
/** How long after a command exits its output may stay open before, on Windows, what it left running is looked for. */
const leftOpenMs = 200

/**
 * Runs a command in `cwd`, with `stdin` as its input, and resolves with how it ended. Once
 * `timeoutMs` passes, it asks the command and everything it started to stop, then kills whatever
 * is left a few seconds later. Whatever the command started is killed as soon as the command
 * exits, timed out or not. Rejects only when the command can't start. An `env` value of undefined
 * removes that variable.
 */
export function runProcess(
  command: string,
  args: string[],
  { cwd, env = {}, stdin = '', timeoutMs }: { cwd: string; env?: Record<string, string | undefined>; stdin?: string; timeoutMs: number },
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const fullEnv = { ...process.env, ...env }
    for (const [name, value] of Object.entries(env)) if (value === undefined) delete fullEnv[name]
    // Its own process group, so a timeout reaches everything the command started; Windows has none,
    // so there it is the process tree. It is recorded, so that if this process dies, the next Run stops it.
    const record = recordProcess({ group: true })
    let line: { file: string; args: string[] }
    try {
      line = commandLine(command, args, { env: fullEnv, cwd })
    } catch (error) {
      record.ended()
      return reject(error)
    }
    const spawning = Date.now()
    const child = spawn(line.file, line.args, { cwd, env: fullEnv, detached: !windows, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe', record.fd] }) as ChildProcessByStdio<Writable, Readable, Readable>
    const spawned = Date.now()
    record.started(child.pid)
    let exited = false
    const signalAll = (signal: NodeJS.Signals) => {
      if (windows) return endTree()
      try {
        process.kill(-child.pid!, signal)
      } catch {}
    }
    // Windows has no signals to ask with: the tree is killed while the command runs, and once it has
    // exited, what it left running is found by its parent's pid.
    const endTree = () => {
      if (child.pid === undefined) return
      if (exited) killAll(processTree(child.pid, spawning, spawned))
      else killTree(child.pid)
    }
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let killTimer: NodeJS.Timeout | undefined
    const finish = (code: number | null) => {
      clearTimeout(timer)
      clearTimeout(killTimer)
      // On Windows the timeout already killed the whole tree at once.
      if (timedOut && !windows) signalAll('SIGKILL')
      record.ended()
      resolve({ code, stdout, stderr, timedOut })
    }
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    // A command that exits without reading its input closes the pipe; how it ended says why.
    child.stdin.on('error', () => {})
    child.stdin.end(stdin)
    const timer = setTimeout(() => {
      timedOut = true
      signalAll('SIGTERM')
      killTimer = setTimeout(() => {
        // Something that left the process group may still hold the pipes, so stop waiting for them.
        child.stdout.destroy()
        child.stderr.destroy()
        child.unref()
        finish(null)
      }, graceMs)
    }, timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      record.ended()
      reject(error)
    })
    // Once the command exits, anything it left running is ended too, so a command it left in the
    // background can't hold its output open or outlive it. Finding those on Windows means listing
    // every process, so there it is done only when something still holds the output open.
    let closed = false
    child.on('exit', () => {
      exited = true
      if (!windows) return signalAll('SIGKILL')
      setTimeout(() => closed || endTree(), leftOpenMs).unref()
    })
    child.on('close', (code) => {
      closed = true
      finish(code)
    })
  })
}
