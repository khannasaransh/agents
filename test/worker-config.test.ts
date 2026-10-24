import assert from 'node:assert/strict'
import { test } from 'node:test'
import { portablePaths, renderWorkerConfig, type Layout } from '../src/worker-config.ts'

// The setup tests install into a home on the OS they run on. These pure checks cover the other OS's
// layout too: how the captured placeholders become a Mac's paths or a Windows machine's.

const mac: Layout = { home: '/Users/khannasaransh', root: '/Users/khannasaransh/Saransh', platform: 'darwin' }
const windows: Layout = { home: 'C:\\Users\\khann', root: 'D:\\Saransh', platform: 'win32' }

const settings = `${JSON.stringify({
  statusLine: { command: '{{home}}/.claude/statusline.sh' },
  note: 'Trusted repo ({{root}}/backend/portfolio-dashboard)',
  routine: 'under {{root}}/backend/portfolio-dashboard/ prefix',
  projects: { '{{root}}/backend/ash_backend': { trusted: true } },
}, null, 2)}\n`
const config = `[projects.'{{root}}/backend/ash_backend']\ntrust_level = "trusted"\n\n[mcp_servers.docs]\nargs = ["--root", "{{root}}/backend"] # {{home}}\n`
const script = 'cd {{home}}/.claude && ./statusline.sh\n'

test("on a Mac, the placeholders become the Mac's paths", () => {
  assert.deepEqual(JSON.parse(renderWorkerConfig('.claude/settings.json', settings, mac)), {
    statusLine: { command: '/Users/khannasaransh/.claude/statusline.sh' },
    note: 'Trusted repo (/Users/khannasaransh/Saransh/backend/portfolio-dashboard)',
    routine: 'under /Users/khannasaransh/Saransh/backend/portfolio-dashboard/ prefix',
    projects: { '/Users/khannasaransh/Saransh/backend/ash_backend': { trusted: true } },
  })
  assert.equal(
    renderWorkerConfig('.codex/config.toml', config, mac),
    `[projects.'/Users/khannasaransh/Saransh/backend/ash_backend']\ntrust_level = "trusted"\n\n[mcp_servers.docs]\nargs = ["--root", "/Users/khannasaransh/Saransh/backend"] # /Users/khannasaransh\n`,
  )
  assert.equal(renderWorkerConfig('.claude/statusline.sh', script, mac), 'cd /Users/khannasaransh/.claude && ./statusline.sh\n')
})

test("on Windows, the placeholders become the Windows machine's paths, in forward slashes where bash may run them and escaped where TOML escapes a backslash", () => {
  // Claude Code runs a status line or hook command through bash on Windows too.
  assert.deepEqual(JSON.parse(renderWorkerConfig('.claude/settings.json', settings, windows)), {
    statusLine: { command: 'C:/Users/khann/.claude/statusline.sh' },
    note: 'Trusted repo (D:/Saransh/backend/portfolio-dashboard)',
    routine: 'under D:/Saransh/backend/portfolio-dashboard/ prefix',
    projects: { 'D:/Saransh/backend/ash_backend': { trusted: true } },
  })
  // A literal string holds a backslash as it is; a basic string escapes it; a comment holds it as it is.
  assert.equal(
    renderWorkerConfig('.codex/config.toml', config, windows),
    `[projects.'D:\\Saransh\\backend\\ash_backend']\ntrust_level = "trusted"\n\n[mcp_servers.docs]\nargs = ["--root", "D:\\\\Saransh\\\\backend"] # C:\\Users\\khann\n`,
  )
  // Bash runs the status line on Windows too, and takes forward slashes.
  assert.equal(renderWorkerConfig('.claude/statusline.sh', script, windows), 'cd C:/Users/khann/.claude && ./statusline.sh\n')
})

test("capturing on a Mac makes paths in the root and home placeholders, the root first since it's inside the home", () => {
  const text = [
    '"command": "/Users/khannasaransh/.claude/statusline.sh"',
    "[projects.'/Users/khannasaransh/Saransh/backend/ash_backend']",
    '[projects."/Users/khannasaransh"]',
    'other = "/Users/khannasaransh2/notes" # someone else\'s home',
  ].join('\n')

  assert.equal(
    portablePaths(text, mac),
    [
      '"command": "{{home}}/.claude/statusline.sh"',
      "[projects.'{{root}}/backend/ash_backend']",
      '[projects."{{home}}"]',
      'other = "/Users/khannasaransh2/notes" # someone else\'s home',
    ].join('\n'),
  )
})

test('capturing on Windows makes paths placeholders however their separators, escaping and letter case are written', () => {
  const text = [
    '"command": "C:\\\\Users\\\\khann\\\\.claude\\\\statusline.sh"',
    "[projects.'d:\\saransh\\backend\\ash_backend']",
    '"note": "Trusted repo (D:\\\\Saransh\\\\backend\\\\portfolio-dashboard), private"',
    'source = "C:/Users/khann/.codex/plugins"',
    "routine = 'under D:\\Saransh\\backend\\portfolio-dashboard\\ prefix'",
  ].join('\n')

  assert.equal(
    portablePaths(text, windows),
    [
      '"command": "{{home}}/.claude/statusline.sh"',
      "[projects.'{{root}}/backend/ash_backend']",
      '"note": "Trusted repo ({{root}}/backend/portfolio-dashboard), private"',
      'source = "{{home}}/.codex/plugins"',
      "routine = 'under {{root}}/backend/portfolio-dashboard/ prefix'",
    ].join('\n'),
  )
  assert.equal(renderWorkerConfig('AGENTS.md', 'Work under {{root}}/backend/ only.\n', windows), 'Work under D:\\Saransh\\backend\\ only.\n')
})
