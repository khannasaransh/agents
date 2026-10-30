# Running the pipeline dashboard

The dashboard shows the daily and weekly pipeline runs saved on this machine: briefs, logs, agents, token usage, timing, findings, and artifacts. Starting it does not run a pipeline or change any pipeline data.

## Start

You need Node.js 26 or newer and npm. Open a terminal and run:

```sh
cd /Users/khannasaransh/Saransh/agents
node --version
npm run dashboard
```

Leave that terminal running, then open [the dashboard](http://127.0.0.1:4310) in your browser. No frontend build or additional packages are required. If you cloned the repository elsewhere, use that folder instead.

The equivalent CLI command is:

```sh
node src/cli.ts dashboard
```

## Stop or restart

Press **Ctrl+C** in the terminal running the dashboard. To restart, run `npm run dashboard` again. Restart the server after changing its TypeScript code, and reload the browser after changing dashboard HTML, CSS, or JavaScript.

The server is local to this machine and is not installed as a background service. Keep the terminal running while using it.

## Choose another port

If port 4310 is already in use:

```sh
npm run dashboard -- --port 4311
```

Then open [port 4311](http://127.0.0.1:4311). If the existing dashboard is already running on port 4310, you can simply open it instead of starting another copy.

## Use a different data folder

By default, the server reads this repository's `data/runs` folder. To inspect another data area on macOS or Linux:

```sh
AGENTS_DATA_DIR=/absolute/path/to/data npm run dashboard
```

The folder must contain `runs/<run-id>/run.json` and the associated logs and outputs. In PowerShell, set `$env:AGENTS_DATA_DIR = 'C:\path\to\data'` before running `npm run dashboard`.

## Navigate

1. Select a run from **Run history**. Filter by daily/weekly, status, or run ID. Bookmark the selected run's URL to return directly to it.
2. Use **Overview** for timing, steps, token totals by agent, PM highlights, skipped/failed steps, review findings, and repository coverage.
3. Use **Brief** to read the generated HTML brief (or Markdown for older runs).
4. Use **Agent activity** to see which agent handled each repository, its worker/model, duration, tokens, and retry attempts. Open the evidence link to its step log.
5. Use **Logs** to choose a step and filter log lines. Use **Artifacts** to search and inspect saved outputs.

The page refreshes every 15 seconds while visible. **Refresh** updates it immediately. All dashboard times are displayed in Singapore time. Schedule cards show repository definitions, not proof that those schedules are installed.

## Token usage

New Codex and Claude Code worker attempts retain their reported token usage in the step log. The dashboard shows input, output, cache reads, cache writes, and totals per attempt, per agent, and for the run. Retries and failed attempts count when the worker reports their usage, including calls whose answers fail schema validation.

Input includes cache reads and writes. Total tokens are input plus output; cache tokens are not added a second time. These are token counts, not a subscription quota or a monetary bill. The parser follows [Codex's event schema](https://github.com/openai/codex/blob/main/sdk/typescript/src/events.ts) and [Claude Code's usage reporting](https://code.claude.com/docs/en/agent-sdk/cost-tracking).

Older pipeline logs did not save token usage, so those runs show **Not recorded** or **—**. Missing usage is never treated as zero. Antigravity and fake-worker runs do not currently record token usage. A reused output does not create a new agent attempt.

The coverage column shows how many recorded attempts include usage. A **+** indicates a partial subtotal: one or more attempts lack usage, a process timed out before final usage, or a large log was truncated. Usage appears when an attempt finishes, not while a model is still generating. For an active run, totals cover completed attempts so far. Re-running a step appends to its log, so earlier attempts and their usage remain included.

## Troubleshooting

- **Connection unavailable:** start the server, check the URL/port, and refresh.
- **No runs:** check the data folder. Only daily and weekly runs are listed.
- **Brief missing:** inspect the Brief step's log; it may have failed or not started yet.
- **Token usage not recorded:** historical logs cannot supply counts they never retained. Future supported-worker attempts populate the columns automatically; no dashboard setting is required.
- **`EADDRINUSE`:** another server owns the port. Open the existing dashboard or choose another port.
- **Node version error:** install or select Node 26 or newer.
- **Opening `index.html` does not load data:** use the HTTP URL above; local HTML cannot directly read pipeline files.

## Checks for contributors

From the repository root:

```sh
npm run typecheck
node --test test/dashboard.test.ts test/token-usage.test.ts test/workers.test.ts test/review.test.ts
```

HTTP tests need permission to bind a temporary loopback port. Worker tests use local stand-ins and do not spend model tokens.

## Portfolio runs

A separate [Portfolio Observatory](http://127.0.0.1:4310/portfolio) reads stocks runs on the same server. See [the portfolio dashboard guide](portfolio-dashboard.md) for Windows setup, copied run data, and portfolio-specific views.
