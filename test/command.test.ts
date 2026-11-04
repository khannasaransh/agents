import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { commandLine } from '../src/command.ts'

const windows = process.platform === 'win32'

test('Cursor Windows launcher runs its newest bundled Node directly, preserving argument boundaries', { skip: !windows }, t => {
  const root = mkdtempSync(join(tmpdir(), 'agents-cursor-launcher-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const shim = join(root, 'agent.cmd')
  writeFileSync(shim, '@echo off\r\n%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%\\cursor-agent.ps1" %*\r\n')
  writeFileSync(join(root, 'cursor-agent.ps1'), '& "$nodePath" "$scriptPath\\versions\\$versionName\\index.js" $args\n')
  for (const version of ['2026.9.28-abcdef0', '2026.10.2-12-30-00-abcdef1']) {
    const folder = join(root, 'versions', version)
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'node.exe'), '')
    writeFileSync(join(folder, 'index.js'), '')
  }
  const args = ['--print', 'literal "quotes" & $value; no shell expansion']
  const latest = join(root, 'versions', '2026.10.2-12-30-00-abcdef1')
  assert.deepEqual(commandLine(shim, args), { file: join(latest, 'node.exe'), args: [join(latest, 'index.js'), ...args] })
})

test('unknown Windows batch commands remain refused, including a misleading agent.cmd name', { skip: !windows }, t => {
  const root = mkdtempSync(join(tmpdir(), 'agents-unknown-launcher-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const shim = join(root, 'agent.cmd')
  writeFileSync(shim, '@echo off\r\necho arbitrary batch command\r\n')
  assert.throws(() => commandLine(shim, ['--print']), /starts nothing through a shell/)
})
