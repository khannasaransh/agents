import { spawn } from 'node:child_process'
import { win32 } from 'node:path'

/**
 * What keeps the machine from sleeping while the process `pid` lives. On Windows a PowerShell that
 * sets the system-required execution state (ES_CONTINUOUS | ES_SYSTEM_REQUIRED) and waits for that
 * process, so idle sleep, Modern Standby among it, doesn't freeze a Run for hours; on the Mac
 * `caffeinate -i`. Each ends by itself once that process does, so a Run that dies can't keep the
 * machine awake. Null where there is none.
 */
export function awakeCommand(pid: number, platform: NodeJS.Platform = process.platform, systemRoot = process.env.SystemRoot ?? 'C:\\Windows'): { file: string; args: string[]; cwd: string } | null {
  if (platform === 'darwin') return { file: 'caffeinate', args: ['-i', '-w', String(pid)], cwd: '/' }
  if (platform !== 'win32') return null
  const system = win32.join(systemRoot, 'System32')
  const script = [
    `$t = Add-Type -Name Awake -Namespace Agents -PassThru -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);'`,
    // 0x80000001: ES_CONTINUOUS | ES_SYSTEM_REQUIRED, held by this thread until it ends.
    `if ($t::SetThreadExecutionState([uint32]2147483649) -eq 0) { exit 1 }`,
    `Wait-Process -Id ${pid} -ErrorAction SilentlyContinue`,
    // A process already gone leaves Wait-Process failed, which would be the exit code.
    'exit 0',
  ].join('; ')
  return { file: win32.join(system, 'WindowsPowerShell', 'v1.0', 'powershell.exe'), args: ['-NoProfile', '-NonInteractive', '-Command', script], cwd: system }
}

/**
 * Keeps the machine awake while this process runs, as a Run does for its hours of refreshing and
 * fetching. Returns a function that lets it sleep again. Failing to start never stops the Run.
 */
export function keepAwake(): () => void {
  const command = awakeCommand(process.pid)
  if (!command) return () => {}
  try {
    const child = spawn(command.file, command.args, { cwd: command.cwd, stdio: 'ignore', windowsHide: true })
    child.on('error', () => {})
    child.unref()
    return () => {
      if (child.exitCode === null) child.kill()
    }
  } catch {
    return () => {}
  }
}
