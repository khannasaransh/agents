const portfolioView = document.body.dataset.view === 'portfolio'
const apiBase = portfolioView ? '/api/portfolio' : '/api'
const $ = selector => document.querySelector(selector)
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))
const list = value => Array.isArray(value) ? value.filter(item => item !== null && item !== undefined) : []
const title = value => value === 'pm' ? 'PM' : escape(String(value).replace(/(^|[- ])\w/g, char => char.toUpperCase()).replaceAll('-', ' '))
const knownStatuses = new Set(['succeeded', 'failed', 'partial', 'running', 'pending', 'skipped', 'answered', 'reviewed'])
const statusClass = status => knownStatuses.has(status) ? status : 'pending'
const badge = status => `<span class="badge ${statusClass(status)}">${escape(status)}</span>`
const date = value => value ? new Date(value).toLocaleString('en-SG', { timeZone:'Asia/Singapore', day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit', hour12:false }) : '—'
const duration = (start, end) => {
  if (!start) return '—'
  const seconds = Math.max(0, Math.round((new Date(end ?? Date.now()) - new Date(start)) / 1000))
  return seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`
}
const runDuration = run => run.endedAt || run.status === 'running' ? duration(run.startedAt, run.endedAt) : 'Unknown'
const fileURL = path => `/runs/${encodeURIComponent(selected)}/${path.split('/').map(encodeURIComponent).join('/')}`
let snapshot, run, selected = new URLSearchParams(location.search).get('run'), tab = 'overview', logStep, logQuery = '', artifactPath = '', artifactQuery = '', logText = '', busy = false, selectionVersion = 0

async function request(url, asText = false) {
  const response = await fetch(url)
  if (!response.ok) throw new Error('Could not load pipeline data. Check that the dashboard server is running, then refresh.')
  return asText ? response.text() : response.json()
}
function showError(error) { $('#error').textContent = error.message; $('#error').hidden = false; $('#connection').textContent = 'Connection unavailable' }
function renderHistory() {
  const query = $('#run-search').value.toLowerCase(), pipeline = $('#pipeline-filter').value, status = $('#status-filter').value
  const visible = snapshot.runs.filter(item => (pipeline === 'all' || item.pipeline === pipeline) && (status === 'all' || item.status === status) && `${item.id} ${item.pipeline} ${item.status}`.toLowerCase().includes(query))
  $('#run-count').textContent = snapshot.runs.length
  $('#history').innerHTML = visible.map(item => `<button class="history-item ${item.id === selected ? 'selected' : ''}" data-run="${escape(item.id)}" aria-pressed="${item.id === selected}"><span class="history-item-top"><span><i class="status-dot ${statusClass(item.status)}"></i>${title(item.pipeline)}${item.dryRun ? ' · dry run' : ''}</span><span>${runDuration(item)}</span></span><small>${date(item.startedAt)} SGT</small></button>`).join('') || '<div class="empty">No matching runs.</div>'
}
function schedules() {
  if (portfolioView) return portfolioSchedules()
  $('#schedules').innerHTML = ['daily','weekly'].map(pipeline => {
    const config = snapshot.schedules.find(item => item.pipeline === pipeline), runs = snapshot.runs.filter(item => item.pipeline === pipeline), latest = runs[0]
    const days = config?.days.map(day => title(day.slice(0,3))).join(', ') ?? 'No schedule'
    return `<article class="schedule-card ${pipeline}"><div class="schedule-top"><span class="pipeline-icon">${pipeline === 'daily' ? '☀' : '▦'}</span><div><h2>${title(pipeline)} pipeline</h2><small>${pipeline === 'daily' ? 'Your daily engineering pulse' : 'A wider view of the week'}</small></div>${badge(latest?.status ?? 'No runs')}</div><div class="schedule-time"><div><strong>${config?.time ?? '—'} <span>SGT</span></strong><small>${days}${config ? ` · ${escape(config.machine)}` : ''}</small></div><span>${runs.length} recorded runs</span></div><div class="activity">${runs.slice(0,20).reverse().map(item => `<button class="${statusClass(item.status)}" data-run="${escape(item.id)}" title="${escape(item.id)} · ${escape(item.status)}" aria-label="Open ${escape(item.id)}, ${escape(item.status)}"></button>`).join('') || '<span class="muted">Waiting for the first run</span>'}</div><div class="activity-caption"><span>Recent run history · oldest → newest</span><span>${latest ? date(latest.startedAt) : 'No activity'}</span></div><small>Schedule definition · installation not checked</small></article>`
  }).join('')
}
const tokenNumber = value => value === null || value === undefined ? '—' : Number(value).toLocaleString('en-SG')
const usageCoverage = usage => !usage?.tokens ? 'Not recorded' : `${usage.recordedAttempts} / ${usage.attempts} attempts${usage.complete && !run.tokenUsage?.truncated ? '' : ' · partial'}`
const tokenTotal = usage => usage?.tokens ? `${tokenNumber(usage.tokens.totalTokens)}${usage.complete && !run.tokenUsage?.truncated ? '' : '+'}` : '—'

function tokenSummary() {
  const usage = run.tokenUsage
  const agents = usage?.agents ?? []
  return `<section class="token-panel"><h3>Tokens by agent <span class="count">· this run, including retries</span></h3><div class="table-wrap"><table><thead><tr><th>Agent</th><th>Input</th><th>Output</th><th>Cache read</th><th>Cache write</th><th>Total</th><th>Coverage</th></tr></thead><tbody>${agents.map(item => `<tr><td><strong>${title(item.agent)}</strong></td><td>${tokenNumber(item.tokens?.inputTokens)}</td><td>${tokenNumber(item.tokens?.outputTokens)}</td><td>${tokenNumber(item.tokens?.cacheReadTokens)}</td><td>${tokenNumber(item.tokens?.cacheWriteTokens)}</td><td><strong>${tokenTotal(item)}</strong></td><td>${usageCoverage(item)}</td></tr>`).join('') || '<tr><td colspan="7">No agent attempts recorded for this run.</td></tr>'}</tbody></table></div><p class="muted">Input includes cache reads and writes; total = input + output. Cache columns are a breakdown, not extra tokens. “+” marks a partial subtotal.</p>${!usage?.tokens ? '<div class="notice neutral">Token usage was not recorded for this run. New Codex and Claude Code attempts will capture reported counts automatically. Older runs and unsupported workers show “—”, never an assumed zero.</div>' : `<p class="muted">${usageCoverage(usage)} with reported usage. Counts appear when an attempt finishes; running calls and unreported usage are excluded.</p>`}</section>`
}

function header() {
  if (portfolioView) return portfolioHeader()
  if (!run) {
    $('#run-heading').innerHTML = '<p>No daily or weekly runs yet. The dashboard will update when a pipeline runs.</p>'
    $('#metrics').innerHTML = ''; $('#content').innerHTML = '<div class="empty">Your briefs, agent activity, and logs will appear here.</div>'; return
  }
  const attempts = run.steps.flatMap(step => step.attempts), findings = list(run.reviews).flatMap(review => list(review.findings))
  $('#history-note').textContent = `${snapshot.runs.length} runs in local history`
  $('#run-heading').innerHTML = `<div><h2>${title(run.pipeline)} / ${escape(run.id)} ${badge(run.status)}</h2><p>${date(run.startedAt)} SGT <span class="slash">/</span> ${run.dryRun ? 'Dry run · fake worker' : 'Live run'} <span class="slash">/</span> ${run.endedAt ? `Finished ${date(run.endedAt)}` : run.status === 'running' ? 'Recorded as running' : 'No end time recorded'}</p></div>${run.files.some(file => /^brief\.(html|md)$/.test(file.path)) ? '<button class="button primary" data-tab="brief">Read brief ↗</button>' : '<span class="muted">Brief not generated</span>'}`
  const metrics = [ ['DURATION', runDuration(run), run.endedAt ? 'Total wall time' : 'From the run record'], ['STEPS COMPLETE', `${run.steps.filter(step => step.status === 'succeeded').length} / ${run.steps.length}`, `${run.steps.filter(step => step.status === 'skipped').length} skipped · ${run.steps.filter(step => step.status === 'failed').length} failed`], ['AGENT ATTEMPTS', attempts.length, `${attempts.filter(attempt => attempt.outcome === 'failed').length} failed attempts in logs`], ['REVIEW FINDINGS', findings.length, `${run.reviews.filter(review => review.status === 'reviewed').length} repositories reviewed`], ['TOKENS REPORTED', tokenTotal(run.tokenUsage), usageCoverage(run.tokenUsage)] ]
  $('#metrics').innerHTML = metrics.map(([label,value,note]) => `<div class="metric"><div class="label">${label}</div><strong>${value}</strong><small>${note}</small></div>`).join('')
}
function overview() {
  if (portfolioView) return portfolioOverview()
  const findings = list(run.reviews).flatMap(review => list(review.findings).map(finding => ({...finding, repo:review.repo})))
  const alerts = run.steps.filter(step => ['failed','skipped','running'].includes(step.status)).map(step => `<div class="notice ${step.status === 'skipped' ? 'neutral' : ''}"><button data-log="${escape(step.name)}"><strong>${title(step.name)} · ${escape(step.status)}</strong><br>${escape(step.note ?? 'No log message yet.')} <span>↗</span></button></div>`)
  const backlog = list(snapshot.backlog[run.pipeline])
  if (backlog.length) alerts.push(`<div class="notice">${backlog.length} run(s) waiting in the current PM backlog: ${backlog.map(escape).join(', ')}</div>`)
  if (!run.files.some(file => /^brief\.(html|md)$/.test(file.path))) alerts.push('<div class="notice neutral">This run has no generated brief yet.</div>')
  $('#content').innerHTML = `<h3>Execution timeline <span class="count">· select a step to inspect its log</span></h3><div class="flow">${run.steps.map((step,index) => `<button class="step ${statusClass(step.status)}" data-log="${escape(step.name)}" title="${escape(step.status)}"><i class="status-dot ${statusClass(step.status)}"></i><span class="step-number">${String(index + 1).padStart(2,'0')}</span><strong>${title(step.name)}</strong><small>${step.endedAt || step.status === 'running' ? duration(step.startedAt,step.endedAt) : '—'} · ${escape(step.status)}</small></button>`).join('')}</div>${tokenSummary()}<div class="overview-columns"><div class="subpanel"><h3>From the brief <span class="count">PM highlights</span></h3>${list(run.pm?.highlights).slice(0,4).map(item => `<p class="highlight">${escape(item)}</p>`).join('') || '<p class="muted">No PM highlights recorded for this run.</p>'}${run.pm?.error ? `<p class="notice">${escape(run.pm.error)}</p>` : ''}<button class="button compact" data-tab="brief">Open full brief →</button></div><div class="subpanel"><h3>Needs attention <span class="count">${alerts.length} notices</span></h3>${alerts.join('') || '<p class="muted">All recorded steps completed successfully. No PM backlog is waiting.</p>'}<details><summary>Scheduled-start log</summary><pre class="artifact-view">${escape(snapshot.scheduleLog || 'No scheduled starts recorded.')}</pre></details></div></div><details class="findings"><summary>Review findings (${findings.length})</summary>${findings.map(finding => `<div class="finding">${badge(finding.severity)} <strong>${escape(finding.repo)}</strong> <code>${escape(finding.file)}${finding.line ? `:${escape(finding.line)}` : ''}</code><br>${escape(finding.summary)}</div>`).join('') || '<p class="muted">No findings recorded.</p>'}</details><details><summary>Repository coverage (${run.fetches.length})</summary><div class="table-wrap"><table><thead><tr><th>Repository</th><th>Fetch result</th><th>New commits</th></tr></thead><tbody>${run.fetches.map(item => `<tr><td>${escape(item.repo)}<small>${escape(item.branch)}</small></td><td>${badge(item.status)}${item.error ? `<small>${escape(item.error)}</small>` : ''}</td><td>${Array.isArray(item.commits) ? item.commits.length : '—'}</td></tr>`).join('')}</tbody></table></div></details>`
}
function agents() {
  const attempts = run.steps.flatMap(step => step.attempts)
  $('#content').innerHTML = `${tokenSummary()}<h3>Who ran what <span class="count">· observed worker attempts from this run’s logs</span></h3><p class="muted">Each row is an actual attempt. Retried calls appear separately; steps may reuse saved outputs or skip calling an agent.${run.dryRun ? ' This dry run used the fake worker; it does not record live attempts.' : ''}</p>${run.steps.some(step => step.logTruncated) ? '<div class="notice">Large logs were truncated to their latest 1 MiB. Attempt counts may be incomplete.</div>' : ''}<div class="table-wrap"><table><thead><tr><th>Agent / target</th><th>Worker / model</th><th>Result</th><th>Duration</th><th>Tokens</th><th>Evidence</th></tr></thead><tbody>${attempts.map(item => `<tr><td><strong>${title(item.agent)}</strong><small>${escape(item.target)}</small></td><td>${escape(item.worker)}<small>${escape(item.model)} · ${escape(item.effort)}</small></td><td>${badge(item.outcome)}${item.error ? `<details><summary>Failure details</summary>${escape(item.error)}</details>` : ''}</td><td>${item.seconds}s</td><td>${item.usage ? `<strong>${tokenNumber(item.usage.totalTokens)}${item.usage.complete ? '' : '+'}</strong><small>${tokenNumber(item.usage.inputTokens)} in · ${tokenNumber(item.usage.outputTokens)} out</small><small>${tokenNumber(item.usage.cacheReadTokens)} cache read · ${tokenNumber(item.usage.cacheWriteTokens)} cache write</small>` : '<span class="muted">Not recorded</span>'}</td><td><button data-log="${escape(item.step)}">${escape(item.step)}.log ↗</button></td></tr>`).join('')}</tbody></table></div>${attempts.length ? '' : '<div class="empty">No live agent attempts recorded.<br>Inspect the step logs and saved artifacts for this run.</div>'}`
}
async function brief(version) {
  const path = run.files.find(file => file.path === 'brief.html')?.path ?? run.files.find(file => file.path === 'brief.md')?.path
  if (!path) { $('#content').innerHTML = '<div class="empty">No brief was generated for this run.<br>Open the Brief step log to see why.<br><button class="button" data-log="brief">View brief log</button></div>'; return }
  $('#content').innerHTML = `${portfolioView ? '<div class="notice neutral">Read-only brief preview. Answer buttons are disabled here. Use the original brief file for its Save answers workflow.</div>' : ''}<div class="toolbar"><h3>Run brief</h3><a class="button compact" href="${fileURL(path)}" target="_blank" rel="noopener">Open separately ↗</a><span class="muted">${escape(path)}</span></div>${path.endsWith('.html') ? `<iframe class="brief-frame" title="Brief for ${escape(selected)}" sandbox="allow-popups" src="${fileURL(path)}"></iframe>` : '<pre id="markdown-brief" class="artifact-view">Loading brief…</pre>'}`
  if (path.endsWith('.md')) { const text = await request(fileURL(path),true); if (version === selectionVersion && tab === 'brief') $('#markdown-brief').textContent = text }
}
function paintLog() {
  const lines = logText.split('\n'), matching = logQuery ? lines.filter(line => line.toLowerCase().includes(logQuery.toLowerCase())) : lines
  $('#log-view').textContent = matching.join('\n') || 'No matching log lines.'
  $('#line-count').textContent = `${matching.length} / ${lines.length} lines`
}
async function logs(version, preserve = false) {
  if (!run.steps.some(step => step.name === logStep)) logStep = run.steps.find(step => step.status === 'failed')?.name ?? run.steps[0]?.name
  const step = run.steps.find(step => step.name === logStep)
  if (!step) { $('#content').innerHTML = '<div class="empty">No steps recorded.</div>'; return }
  if (!preserve) $('#content').innerHTML = `<div class="toolbar"><select id="log-step" aria-label="Step log">${run.steps.map(item => `<option value="${escape(item.name)}" ${item.name === logStep ? 'selected' : ''}>${title(item.name)} · ${escape(item.status)}</option>`).join('')}</select><input id="log-search" aria-label="Filter log lines" placeholder="Filter log lines…" value="${escape(logQuery)}"><a class="button compact" href="${fileURL(step.log)}" target="_blank" rel="noopener">Raw log ↗</a><span class="muted" id="line-count"></span></div><pre class="log-view" id="log-view">Loading log…</pre>`
  const name = logStep
  const available = run.files.some(file => file.path === step.log)
  const text = available ? await request(fileURL(step.log),true) : 'No log file yet. This step may not have started.'
  if (version !== selectionVersion || tab !== 'logs' || name !== logStep) return
  const scroll = $('#log-view').scrollTop
  logText = text; paintLog(); if (preserve) $('#log-view').scrollTop = scroll
}
function artifactList() {
  $('#artifact-list').innerHTML = run.files.filter(file => file.path.toLowerCase().includes(artifactQuery.toLowerCase())).map(file => `<button class="artifact-item" data-artifact="${escape(file.path)}">${escape(file.path)} <span>${file.bytes < 1024 ? `${file.bytes} B` : `${(file.bytes/1024).toFixed(1)} KB`} ↗</span></button>`).join('') || '<div class="empty">No matching artifacts.</div>'
}
function artifacts() {
  $('#content').innerHTML = '<div class="toolbar"><h3>Saved run artifacts</h3><input id="artifact-search" aria-label="Search artifacts" placeholder="Find an output, review, or log…"></div><div class="artifact-grid" id="artifact-list"></div><div id="artifact-preview"></div>'
  $('#artifact-search').value = artifactQuery; artifactList()
}
async function showArtifact(path) {
  artifactPath = path
  if (path.endsWith('.html')) {
    $('#artifact-preview').innerHTML = `<div class="toolbar"><h3>${escape(path)}</h3><a class="button compact" href="${fileURL(path)}" target="_blank" rel="noopener">Open separately ↗</a></div><iframe class="brief-frame" title="Artifact ${escape(path)}" sandbox="allow-popups" src="${fileURL(path)}"></iframe>`
    return
  }
  const version = selectionVersion
  $('#artifact-preview').innerHTML = '<pre class="artifact-view">Loading artifact…</pre>'
  try {
    const text = await request(fileURL(path),true)
    if (version !== selectionVersion || tab !== 'artifacts' || artifactPath !== path) return
    $('#artifact-preview').innerHTML = `<div class="toolbar"><h3>${escape(path)}</h3><a class="button compact" href="${fileURL(path)}" target="_blank" rel="noopener">Open raw ↗</a></div><pre class="artifact-view"></pre>`
    $('#artifact-preview pre').textContent = text
  } catch (error) { showError(error) }
}
async function setTab(next) {
  tab = next
  document.querySelectorAll('[data-tab]').forEach(button => { const active = button.dataset.tab === tab; button.classList.toggle('selected',active); button.setAttribute('aria-pressed',String(active)) })
  document.querySelectorAll('[data-nav]').forEach(button => button.classList.toggle('active',button.dataset.nav === tab))
  if (!run) return
  try {
    if (tab === 'overview') overview()
    if (tab === 'agents') agents()
    if (portfolioView && tab === 'holdings') portfolioHoldings()
    if (portfolioView && tab === 'attention') portfolioAttention()
    if (tab === 'brief') await brief(selectionVersion)
    if (tab === 'logs') await logs(selectionVersion)
    if (tab === 'artifacts') artifacts()
  } catch (error) { showError(error) }
}
async function selectRun(id) {
  const version = ++selectionVersion
  selected = id; logStep = undefined; artifactPath = ''
  const url = new URL(location.href); url.searchParams.set('run',id); window.history.replaceState(null,'',url)
  renderHistory(); $('#content').innerHTML = '<div class="empty">Loading run…</div>'
  try {
    const result = await request(`${apiBase}/run?id=${encodeURIComponent(id)}`)
    if (version !== selectionVersion) return
    run = result; header(); await setTab(tab)
  } catch (error) { if (version === selectionVersion) { run = null; $('#content').innerHTML = '<div class="empty">Run unavailable. Refresh or select another run.</div>'; showError(error) } }
}
async function refresh(manual = false) {
  if (busy) return
  busy = true; $('#refresh').disabled = true
  try {
    snapshot = await request(`${apiBase}/dashboard`)
    $('#error').hidden = !snapshot.warnings.length; $('#error').textContent = snapshot.warnings.join(' ')
    $('#connection').textContent = `Updated ${new Date(snapshot.generatedAt).toLocaleTimeString('en-SG',{timeZone:'Asia/Singapore',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false})}`
    schedules(); renderHistory()
    if (!selected || !snapshot.runs.some(item => item.id === selected)) {
      if (snapshot.runs[0]) await selectRun(snapshot.runs[0].id)
      else { run = null; header() }
    } else {
      const version = selectionVersion, id = selected
      const latest = await request(`${apiBase}/run?id=${encodeURIComponent(id)}`)
      if (version !== selectionVersion) return
      const changed = JSON.stringify(latest) !== JSON.stringify(run)
      run = latest; header()
      if (tab === 'logs' && $('#log-view')) await logs(version,true)
      else if (changed || manual) await setTab(tab)
    }
  } catch (error) { showError(error) }
  finally { busy = false; $('#refresh').disabled = false }
}
document.addEventListener('click', async event => {
  const button = event.target.closest('button'); if (!button) return
  if (button.dataset.run) await selectRun(button.dataset.run)
  else if (button.dataset.tab) await setTab(button.dataset.tab)
  else if (button.dataset.nav) await setTab(button.dataset.nav)
  else if (button.dataset.log) { logStep = button.dataset.log; logQuery = ''; await setTab('logs') }
  else if (button.dataset.artifact) await showArtifact(button.dataset.artifact)
})
document.addEventListener('input', event => {
  if (event.target.id === 'run-search') renderHistory()
  if (event.target.id === 'log-search') { logQuery = event.target.value; paintLog() }
  if (event.target.id === 'artifact-search') { artifactQuery = event.target.value; artifactList() }
})
document.addEventListener('change', async event => {
  if (['pipeline-filter','status-filter'].includes(event.target.id)) renderHistory()
  if (event.target.id === 'log-step') { logStep = event.target.value; await setTab('logs') }
})
$('#refresh').addEventListener('click',() => refresh(true))
refresh(); setInterval(() => { if (!document.hidden) refresh() },15000)
