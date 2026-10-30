# Running the portfolio dashboard

The Portfolio Observatory reads saved runs of the `stocks` pipeline. It is a separate page from the daily/weekly engineering dashboard, served by the same local server.

## Start on this Mac

Use Node.js 26 or newer. From a terminal:

```sh
cd /Users/khannasaransh/Saransh/agents
npm run dashboard
```

Open [Portfolio Observatory](http://127.0.0.1:4310/portfolio). The [engineering dashboard](http://127.0.0.1:4310/) remains available at the root URL. If the server is already running, simply open the portfolio URL.

Keep the terminal running. Press **Ctrl+C** to stop the server. Restart it after updating server code; reload the page after updating dashboard assets. No frontend build or additional packages are needed.

For another port:

```sh
npm run dashboard -- --port 4312
```

Then open http://127.0.0.1:4312/portfolio.

## Connect the Windows portfolio runs

The stocks schedule in this repository targets Windows, Tuesday through Saturday at 09:30 Singapore time. The schedule displayed by the dashboard is its repository definition; the dashboard does not verify its installation or start runs.

This Mac's default data folder currently contains daily and weekly engineering runs. A portfolio page with no runs is expected until it can read stocks run snapshots.

Choose one of these approaches:

### Run the dashboard on Windows

In PowerShell, change to the agents repository on that machine and run:

```powershell
npm run dashboard
```

Open http://127.0.0.1:4310/portfolio **on that Windows machine**. It reads the repository's `data\runs` folder by default.

If the scheduled pipeline uses a different data folder, set it before starting:

```powershell
$env:AGENTS_DATA_DIR = 'C:\path\to\agents-data'
npm run dashboard
```

### Read a copied or mounted data folder on the Mac

Copy complete stocks run folders from Windows into this repository's `data/runs`, keeping their IDs and contents intact. Avoid overwriting an existing run folder with the same ID. Alternatively, use a separate data area:

```sh
AGENTS_DATA_DIR=/absolute/path/to/portfolio-data npm run dashboard -- --port 4312
```

The expected layout is:

```text
portfolio-data/
  runs/
    <run-id>/
      run.json              # pipeline must be "stocks"
      brief.html
      logs/
        lake.log
        health.log
        ...
      lake.json
      lake/status.json
      health.json
      health/status.json
      broker-inbox.json
      answers.json
      marketsmith.json
      todos/
  scheduled-starts.log       # optional
```

Outputs that were never generated may be absent. Missing snapshots appear as unavailable, never as zero balances or passing data checks. The server only listens on loopback, so a browser on the Mac cannot reach the Windows server directly; use a local copy or mounted folder if you want to browse from the Mac. The dashboard does not copy or sync files itself.

## What each view shows

- **Overview:** the run's data gate, separate India/US/Hong Kong book snapshots, execution timeline, health diagnosis, market freshness, refresh attempts, and agent tokens.
- **Books & holdings:** holdings, cash, recorded prices and dates, broker reconciliation differences, and processed broker files. Book values remain in their original currencies; no FX conversion or combined valuation is inferred.
- **Needs attention:** corrections, quarantines, health flags, to-dos, processed answers, and MarketSmith results. The most recent validly dated Lake/Health status snapshot supplies the attention items. The data gate and market freshness retain the Lake step's snapshot.
- **Brief:** the original run brief, displayed read-only. Scripts and Answer buttons are disabled in the preview and the separately opened server copy. To use the existing **Save answers** workflow, open the original `brief.html` file from the run folder in a browser. This dashboard never applies an answer.
- **Agents & tokens:** actual logged attempts with worker, model, input/output/cache tokens, failures, retries, and per-agent totals. Older logs without usage show **Not recorded**. See the [token-accounting guide](dashboard.md#token-usage).
- **Logs / Artifacts:** searchable step logs and saved JSON, Markdown, and HTML outputs.

Run history is searchable and filterable by status. A selected run's URL can be bookmarked. The page refreshes every 15 seconds while visible. All dashboard times are Singapore time.

The current stocks pipeline implements Answers, Broker inbox, MarketSmith, Lake, Health, and Brief steps. The dashboard displays their recorded outputs; it does not invent Portfolio Manager decisions, order lists, analyst calls, or performance history that the pipeline has not produced.

## Troubleshooting

- **No portfolio runs:** check the displayed data source and confirm `runs/<id>/run.json` has `"pipeline": "stocks"`. Engineering runs intentionally do not appear here.
- **Unknown data gate:** the run has no readable `lake/status.json`; inspect the Lake log.
- **Missing holdings:** inspect the Broker inbox step and `broker-inbox.json`. No recorded portfolio is different from a portfolio with zero holdings.
- **No agent calls:** a healthy Lake skips the Health agent, and reused outputs do not create new calls.
- **No token data:** older runs did not retain usage. New supported-worker calls record it on completion.
- **Connection unavailable:** check that the server is running on the port in your URL.
- **Port already in use:** use the existing dashboard or start on another port.

## Validation

```sh
npm run typecheck
node --test test/dashboard.test.ts test/portfolio-dashboard.test.ts test/token-usage.test.ts
```

HTTP tests bind temporary loopback ports and use isolated fixtures. They do not run a portfolio pipeline or trade anything.
