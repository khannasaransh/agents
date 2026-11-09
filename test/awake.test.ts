import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { awakeCommand } from '../src/awake.ts'

test("on Windows a Run is kept awake by a PowerShell that holds the system-required state until the Run's process ends", () => {
  const command = awakeCommand(4242, 'win32', 'C:\\WINDOWS')!

  assert.equal(command.file, 'C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
  assert.equal(command.cwd, 'C:\\WINDOWS\\System32', 'never a folder a test or Run deletes')
  const script = command.args.at(-1)!
  assert.match(script, /SetThreadExecutionState\(\[uint32\]2147483649\)/, 'ES_CONTINUOUS | ES_SYSTEM_REQUIRED')
  assert.match(script, /Wait-Process -Id 4242\b/)
})

test("on the Mac a Run is kept awake by caffeinate, which ends with the Run's process", () => {
  assert.deepEqual(awakeCommand(4242, 'darwin'), { file: 'caffeinate', args: ['-i', '-w', '4242'], cwd: '/' })
})

test('elsewhere nothing keeps a Run awake', () => {
  assert.equal(awakeCommand(4242, 'linux'), null)
})

test("the Windows keep-awake script sets the state and ends once the process it waits for has", { skip: process.platform !== 'win32' && 'Windows only' }, () => {
  // A pid that has already ended: the script sets the state, finds nothing to wait for, and exits 0.
  const ended = spawnSync(process.execPath, ['-e', ''])
  const command = awakeCommand(ended.pid!)!

  const ran = spawnSync(command.file, command.args, { cwd: command.cwd, encoding: 'utf8', windowsHide: true, timeout: 60_000 })

  assert.equal(ran.status, 0, ran.stderr)
})
