import { spawn } from 'node:child_process'

/**
 * Settings that stop git from ever asking for credentials, so an unattended Run fails instead of
 * hanging. An empty GIT_ASKPASS turns off every askpass helper, including core.askPass and
 * SSH_ASKPASS (an editor's terminal often sets one that would pop up a prompt). Credential helpers
 * that answer without asking, such as osxkeychain, still work.
 */
const nonInteractive = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: '',
  SSH_ASKPASS: '',
  GIT_SSH_COMMAND: 'ssh -o BatchMode=yes',
  GCM_INTERACTIVE: 'never',
}

/**
 * Runs git in `cwd` without prompts, returning its stdout. Rejects with git's error output on a
 * non-zero exit, and kills git and everything it started once `timeoutMs` passes.
 */
export function runGit(cwd: string, args: string[], { timeoutMs = 60_000 } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    // Its own process group, so a timeout also kills the transport git started (ssh, https helper).
    const child = spawn('git', args, { cwd, env: { ...process.env, ...nonInteractive }, detached: true })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    const timer = setTimeout(() => {
      timedOut = true
      try {
        process.kill(-child.pid!, 'SIGKILL')
      } catch {}
    }, timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) reject(new Error(`git ${args[0]} timed out after ${Math.round(timeoutMs / 1000)}s`))
      else if (code !== 0) reject(new Error(stderr.trim() || `git ${args[0]} exited with ${code}`))
      else resolve(stdout)
    })
  })
}
