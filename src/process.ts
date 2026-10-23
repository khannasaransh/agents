import { spawn } from 'node:child_process'

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
    // Its own process group, so a timeout reaches everything the command started.
    const child = spawn(command, args, { cwd, env: fullEnv, detached: true })
    const signalAll = (signal: NodeJS.Signals) => {
      try {
        process.kill(-child.pid!, signal)
      } catch {}
    }
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let killTimer: NodeJS.Timeout | undefined
    const finish = (code: number | null) => {
      clearTimeout(timer)
      clearTimeout(killTimer)
      if (timedOut) signalAll('SIGKILL')
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
      reject(error)
    })
    // Once the command exits, anything it left running is ended too, so a command it left in the
    // background can't hold its output open or outlive it.
    child.on('exit', () => signalAll('SIGKILL'))
    child.on('close', finish)
  })
}
