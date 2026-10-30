# Pipeline Observatory

Start from the repository root with Node 26 or newer:

```sh
npm run dashboard
```

Open http://127.0.0.1:4310. Use `npm run dashboard -- --port 4311` for a different port. Stop with Ctrl+C. The dashboard needs this server; opening `index.html` directly cannot read local run files.

This dependency-free HTML dashboard reads daily and weekly runs from `data/runs` (or `AGENTS_DATA_DIR/runs`). It refreshes every 15 seconds while visible. It never starts pipelines, changes run records, or installs schedules.

- Search and filter run history; selected runs have bookmarkable URLs.
- View schedule definitions, status, duration, completed/skipped/failed steps, PM backlog, and scheduled-start logs. Schedule installation is not verified.
- Read HTML briefs in a sandboxed frame, with Markdown fallback for older runs.
- See actual logged agent attempts, repository targets, workers, models, effort, duration, failures, and retries. Reused outputs and fake-worker runs do not imply a new live attempt. Attempts are only recorded after success or failure, so active calls may not appear yet.
- Inspect step logs, filter their lines, and browse saved JSON, Markdown, and HTML artifacts.
- Review findings, repository coverage, and PM highlights.

The server binds only to loopback, rejects non-local Host headers, serves no environment files, blocks path traversal and symlink escapes, and disables scripts inside briefs. Large text files show their latest 1 MiB with a truncation notice; attempt counts from truncated logs may be incomplete. Data remains on this machine.

Validation: `npm run typecheck` and `node --test test/dashboard.test.ts`. HTTP tests require permission to bind a temporary loopback port.

For startup, shutdown, alternate ports, token accounting, and troubleshooting, see [the dashboard guide](../docs/dashboard.md).
