import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { agentsRoot } from '../src/paths.ts'
import { allowsWakeTimers, launchdEntry, loadSchedules, machineSchedules, taskSchedulerEntry, type NamedSchedule } from '../src/schedule.ts'
import { makeWorkspace } from './helpers.ts'

const install = { node: '/opt/homebrew/bin/node', shellPath: '/opt/homebrew/bin:/usr/bin:/bin', dataDir: '/Users/saransh/agents/data' }

/** The text of the plist value right after `<key>name</key>`. */
function valueOf(plist: string, key: string): string | undefined {
  return plist.match(new RegExp(`<key>${key}</key>\\s*(<(\\w+)>[\\s\\S]*?</\\2>|<\\w+/>)`))?.[1]
}

/** The calendar times in a plist's StartCalendarInterval, as [Weekday, Hour, Minute]. */
function calendarTimes(plist: string): number[][] {
  const intervals = valueOf(plist, 'StartCalendarInterval') ?? ''
  return [...intervals.matchAll(/<dict>([\s\S]*?)<\/dict>/g)].map(([, dict]) =>
    ['Weekday', 'Hour', 'Minute'].map((key) => Number(dict.match(new RegExp(`<key>${key}</key>\\s*<integer>(\\d+)</integer>`))?.[1])),
  )
}

/** The daily Schedule, from this repo's Schedule definitions. */
async function dailySchedule(): Promise<NamedSchedule> {
  const daily = (await loadSchedules()).find((schedule) => schedule.name === 'daily')
  assert.ok(daily, 'there is a daily Schedule')
  return daily
}

/** The stocks Schedule, from this repo's Schedule definitions. */
async function stocksSchedule(): Promise<NamedSchedule> {
  const stocks = (await loadSchedules()).find((schedule) => schedule.name === 'stocks')
  assert.ok(stocks, 'there is a stocks Schedule')
  return stocks
}

test('the daily Schedule runs the daily Pipeline on the Mac, Monday to Friday at 05:30', async () => {
  assert.deepEqual(await dailySchedule(), { name: 'daily', pipeline: 'daily', machine: 'mac', days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'], time: '05:30' })
})

test('the stocks Schedule runs the stocks Pipeline on the Windows machine, Tuesday to Saturday at 09:30 Singapore time, 07:00 IST', async () => {
  assert.deepEqual(await stocksSchedule(), { name: 'stocks', pipeline: 'stocks', machine: 'windows', days: ['tuesday', 'wednesday', 'thursday', 'friday', 'saturday'], time: '09:30' })
})

test('the weekly Schedule runs the weekly Pipeline on the Mac, on Sunday at 05:30', async () => {
  const weekly = (await loadSchedules()).find((schedule) => schedule.name === 'weekly')
  assert.ok(weekly, 'there is a weekly Schedule')
  assert.deepEqual(weekly, { name: 'weekly', pipeline: 'weekly', machine: 'mac', days: ['sunday'], time: '05:30' })

  const { plist } = launchdEntry(weekly, install)
  assert.deepEqual(
    [...valueOf(plist, 'ProgramArguments')!.matchAll(/<string>(.*?)<\/string>/g)].map(([, arg]) => arg),
    ['/opt/homebrew/bin/node', join(agentsRoot, 'src', 'cli.ts'), 'run', 'weekly', '--scheduled'],
  )
  assert.deepEqual(calendarTimes(plist), [[0, 5, 30]])
})

test('each machine installs only its own Schedules', async () => {
  const schedules = await loadSchedules()

  assert.deepEqual(
    machineSchedules(schedules, 'darwin').map((s) => s.name),
    ['daily', 'weekly'],
  )
  assert.deepEqual(
    machineSchedules(schedules, 'win32').map((s) => s.name),
    ['stocks'],
  )
  assert.throws(() => machineSchedules(schedules, 'linux'), /Schedules install on the Mac \(launchd\) and on Windows \(Task Scheduler\), not on linux/)
})

test("the daily Schedule's launchd entry starts a scheduled Run of the daily Pipeline Monday to Friday at 05:30", async () => {
  const daily = await dailySchedule()

  const entry = launchdEntry(daily, install)

  assert.equal(entry.label, 'local.agents.daily')
  assert.match(valueOf(entry.plist, 'Label')!, /<string>local\.agents\.daily<\/string>/)
  assert.deepEqual(
    [...valueOf(entry.plist, 'ProgramArguments')!.matchAll(/<string>(.*?)<\/string>/g)].map(([, arg]) => arg),
    ['/opt/homebrew/bin/node', join(agentsRoot, 'src', 'cli.ts'), 'run', 'daily', '--scheduled'],
  )
  assert.deepEqual(calendarTimes(entry.plist), [
    [1, 5, 30],
    [2, 5, 30],
    [3, 5, 30],
    [4, 5, 30],
    [5, 5, 30],
  ])
})

test("a launchd entry runs with the installing shell's PATH, since launchd doesn't load the shell profile, from the agents repo", async () => {
  const daily = await dailySchedule()

  const { plist } = launchdEntry(daily, {
    node: '/Users/saransh/.nvm/versions/node/v25.2.0/bin/node',
    shellPath: '/Users/saransh/.local/bin:/opt/homebrew/bin:/usr/bin',
    dataDir: '/Users/saransh/agents/data',
  })

  // The Worker CLIs are node scripts, so node's folder must be on it even when the shell found node another way.
  assert.equal(
    valueOf(valueOf(plist, 'EnvironmentVariables')!, 'PATH'),
    '<string>/Users/saransh/.nvm/versions/node/v25.2.0/bin:/Users/saransh/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>',
  )
  assert.equal(valueOf(plist, 'WorkingDirectory'), `<string>${agentsRoot}</string>`)
  // A scheduled Run uses the data area the entry was installed for, as its launchd output does.
  assert.equal(valueOf(valueOf(plist, 'EnvironmentVariables')!, 'AGENTS_DATA_DIR'), '<string>/Users/saransh/agents/data</string>')
  assert.equal(valueOf(plist, 'StandardOutPath'), `<string>${join('/Users/saransh/agents/data', 'launchd', 'daily.log')}</string>`)
  assert.equal(valueOf(plist, 'StandardErrorPath'), `<string>${join('/Users/saransh/agents/data', 'launchd', 'daily.log')}</string>`)
})

test("a launchd entry's PATH lists each folder once", async () => {
  const daily = await dailySchedule()

  const { plist } = launchdEntry(daily, install)

  assert.equal(valueOf(valueOf(plist, 'EnvironmentVariables')!, 'PATH'), '<string>/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>')
})

test('a launchd entry starts only at its calendar times, so a time missed while the Mac slept runs once on wake, and installing it starts nothing', async () => {
  const daily = await dailySchedule()

  const { plist } = launchdEntry(daily, install)

  // launchd starts a StartCalendarInterval job on wake for a time it slept through, coalescing several missed times into one start.
  assert.ok(valueOf(plist, 'StartCalendarInterval'))
  assert.equal(valueOf(plist, 'StartInterval'), undefined)
  assert.equal(valueOf(plist, 'RunAtLoad'), undefined)
  assert.equal(valueOf(plist, 'KeepAlive'), undefined)
})

test("a launchd entry names launchd's weekdays and the Schedule's hour and minute", () => {
  const weekend: NamedSchedule = { name: 'weekend', pipeline: 'daily', machine: 'mac', days: ['saturday', 'sunday'], time: '09:05' }

  const { label, plist } = launchdEntry(weekend, install)

  assert.equal(label, 'local.agents.weekend')
  assert.deepEqual(calendarTimes(plist), [
    [6, 9, 5],
    [0, 9, 5],
  ])
})

test('a Schedule whose time is not a time of day has no launchd entry', () => {
  for (const time of ['5:30', '24:00', '05:60', '05:30pm']) {
    assert.throws(() => launchdEntry({ name: 'daily', pipeline: 'daily', machine: 'mac', days: ['monday'], time }, install), /Schedule daily: time .* is not HH:MM/)
    assert.throws(() => taskSchedulerEntry({ name: 'stocks', pipeline: 'stocks', machine: 'windows', days: ['monday'], time }, windowsInstall), /Schedule stocks: time .* is not HH:MM/)
  }
})

test('a scheduled start records the Run it started and how the Run ended', async () => {
  const ws = makeWorkspace()
  try {
    ws.writeRepoList()

    await ws.agents('run', 'daily', '--scheduled', '--dry-run')

    const [id] = ws.runIds()
    assert.equal(readFileSync(join(ws.dataDir, 'scheduled-starts.log'), 'utf8').replace(/^\S+Z /, ''), `daily: started Run ${id}, which ended ${ws.readRun(id).status}\n`)
  } finally {
    ws.cleanup()
  }
})

test('a Run started by hand records no scheduled start', async () => {
  const ws = makeWorkspace()
  try {
    ws.writeRepoList()

    await ws.agents('run', 'daily', '--dry-run')

    assert.equal(existsSync(join(ws.dataDir, 'scheduled-starts.log')), false)
  } finally {
    ws.cleanup()
  }
})

const windowsInstall = {
  node: 'C:\\Program Files\\nodejs\\node.exe',
  shellPath: 'C:\\Users\\saransh\\.local\\bin;C:\\Program Files\\nodejs;C:\\Users\\saransh\\AppData\\Roaming\\npm;C:\\WINDOWS\\system32',
  dataDir: 'D:\\Saransh\\agents\\data',
  systemRoot: 'C:\\WINDOWS',
  today: '2026-10-25',
}

/** The text of each element named `tag` in a Task Scheduler entry. */
function elements(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map(([, text]) => text)
}

const unescape = (text: string) => text.replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')

test("the stocks Schedule's Task Scheduler entry starts a scheduled Run of the stocks Pipeline Tuesday to Saturday at 09:30 on the machine's clock", async () => {
  const entry = taskSchedulerEntry(await stocksSchedule(), windowsInstall)

  assert.equal(entry.name, '\\agents\\stocks')
  assert.deepEqual(elements(entry.xml, 'URI'), ['\\agents\\stocks'])
  // A time with no offset is the machine's own clock, whatever its time zone.
  assert.deepEqual(elements(entry.xml, 'StartBoundary'), ['2026-10-25T09:30:00'])
  assert.deepEqual(elements(entry.xml, 'DaysOfWeek'), ['<Tuesday /><Wednesday /><Thursday /><Friday /><Saturday />'])
  assert.deepEqual(elements(entry.xml, 'WeeksInterval'), ['1'])
  assert.deepEqual(elements(entry.xml, 'Command'), ['C:\\Program Files\\nodejs\\node.exe'])
  assert.deepEqual(elements(entry.xml, 'WorkingDirectory'), [agentsRoot.replace(/[\\/]$/, '')])
  assert.equal(entry.args.slice(0, 4).join(' '), `${join(agentsRoot, 'src', 'cli.ts')} run stocks --scheduled`)
})

test('a Task Scheduler entry wakes the machine, starts a missed time once it is available, and runs only while Saransh is logged on', async () => {
  const { xml } = taskSchedulerEntry(await stocksSchedule(), windowsInstall)

  assert.deepEqual(elements(xml, 'WakeToRun'), ['true'])
  assert.deepEqual(elements(xml, 'StartWhenAvailable'), ['true'])
  // Logged on only, so no password is stored.
  assert.deepEqual(elements(xml, 'LogonType'), ['InteractiveToken'])
  assert.deepEqual(elements(xml, 'RunLevel'), ['LeastPrivilege'])
  assert.deepEqual(elements(xml, 'DisallowStartIfOnBatteries'), ['false'])
  // Every start reaches the Run lock, which refuses one while a Run is active and records it.
  assert.deepEqual(elements(xml, 'MultipleInstancesPolicy'), ['Parallel'])
})

test("a Task Scheduler entry sets its own PATH, with node's folder first and Windows' own after, each once, and pins the data area", async () => {
  const { args, path } = taskSchedulerEntry(await stocksSchedule(), windowsInstall)

  assert.equal(
    path,
    'C:\\Program Files\\nodejs;C:\\Users\\saransh\\.local\\bin;C:\\Users\\saransh\\AppData\\Roaming\\npm;C:\\WINDOWS\\system32;C:\\WINDOWS;C:\\WINDOWS\\System32\\Wbem;C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0',
  )
  assert.deepEqual(args.slice(4), ['--env', `PATH=${path}`, '--env', 'AGENTS_DATA_DIR=D:\\Saransh\\agents\\data'])
})

test("a Task Scheduler entry's arguments reach the agents command as they were given", { skip: process.platform !== 'win32' && 'Windows parses a command line itself' }, async () => {
  const { xml, args } = taskSchedulerEntry(await stocksSchedule(), { ...windowsInstall, shellPath: 'C:\\Program Files (x86)\\Tools\\;C:\\odd "quoted" dir;C:\\a&b' })
  const folder = mkdtempSync(join(tmpdir(), 'agents-args-'))
  try {
    const printer = join(folder, 'argv.js')
    writeFileSync(printer, 'console.log(JSON.stringify(process.argv.slice(2)))')
    const [line] = elements(xml, 'Arguments')

    const printed = spawnSync(process.execPath, [`"${printer}"`, unescape(line)], { argv0: `"${process.execPath}"`, windowsVerbatimArguments: true, encoding: 'utf8' })

    assert.equal(printed.status, 0, printed.stderr)
    assert.deepEqual(JSON.parse(printed.stdout), args)
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
})

test('a scheduled start sets the environment the entry gives it before the Run starts', async () => {
  const ws = makeWorkspace()
  try {
    ws.setPd({
      status: { example: 'status.healthy.json' },
      'book-holdings': { example: 'book-holdings.empty.json' },
      stages: { example: 'stages-check.empty.json' },
      plan: { example: 'plan.shadow.json' },
      'book-state': { example: 'book-state.india.json' },
    })
    const elsewhere = join(ws.dataDir, '..', 'pinned-data')

    const result = await ws.agents('run', 'stocks', '--scheduled', '--dry-run', '--env', `AGENTS_DATA_DIR=${elsewhere}`)

    assert.equal(result.status, 0, result.stderr)
    assert.equal(ws.runIds().length, 0, 'the Run used the pinned data area')
    assert.match(readFileSync(join(elsewhere, 'scheduled-starts.log'), 'utf8'), /stocks: started Run \S+, which ended succeeded\n$/)
  } finally {
    ws.cleanup()
  }
})

/** What `powercfg /query SCHEME_CURRENT SUB_SLEEP RTCWAKE` prints, with Allow wake timers at `index` on mains power. */
const powercfg = (index: number) => `Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Balanced)
  GUID Alias: SCHEME_BALANCED
  Subgroup GUID: 238c9fa8-0aad-41ed-83f4-97be242c8f20  (Sleep)
    GUID Alias: SUB_SLEEP
    Power Setting GUID: bd3b718a-0680-4d9d-8ab2-e1d2b4ac806d  (Allow wake timers)
      GUID Alias: RTCWAKE
      Possible Setting Index: 000
      Possible Setting Friendly Name: Disable
      Possible Setting Index: 001
      Possible Setting Friendly Name: Enable
      Possible Setting Index: 002
      Possible Setting Friendly Name: Important Wake Timers Only
    Current AC Power Setting Index: 0x0000000${index}
    Current DC Power Setting Index: 0x00000000
`

test("a power plan allows a Schedule to wake the machine only with wake timers enabled on mains power", () => {
  assert.equal(allowsWakeTimers(powercfg(1)), true)
  assert.equal(allowsWakeTimers(powercfg(0)), false)
  // Important wake timers only leaves out Task Scheduler's.
  assert.equal(allowsWakeTimers(powercfg(2)), false)
  assert.equal(allowsWakeTimers('Invalid Parameters -- try "/?" for help'), null)
})
