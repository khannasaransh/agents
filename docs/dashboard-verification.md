# Dashboard verification — 29 October 2026

Both dashboards were run locally and checked against their code, saved data contracts, automated tests, and browser behavior.

- Engineering: http://127.0.0.1:4310/
- Portfolio: http://127.0.0.1:4310/portfolio
- Start both: `npm run dashboard` from the repository root.

## Findings fixed

| Finding | Change | Verification |
| --- | --- | --- |
| Opening any HTML artifact redirected to the main brief, even when a different report was selected. | The artifact view now previews the selected HTML path in its own sandboxed frame. | Rendering regression test and browser check with an independent `reports/extra.html`. |
| Valid JSON with null steps, missing dates, or invalid timestamps could crash history loading or produce invalid durations. | Run records validate statuses, timestamps, and step structure; invalid records are omitted with a warning. | Regression cases for null steps and missing, numeric, and invalid dates; valid runs remain visible. |
| An outside run directory could be accepted if its `run.json` linked back into the permitted data area. | Validate the resolved run directory as well as each file. | Regression fixture confirms outside outputs cannot be read through that linked record. |
| Step labels were inserted into HTML without escaping, and malformed optional arrays could crash views. | Escape display labels and guard review findings, highlights, backlog, and portfolio list values. | Rendering tests with HTML-like labels, null entries, and wrong-shaped arrays. |
| A failed correction-proposal write hid a successful Health diagnosis and described it as an agent failure. | Preserve the diagnosis and display the proposal failure separately. Handle a missing Health step safely. | Regression test and browser refresh with a partial run and failed Health step. |
| The scheduled-environment test used a “healthy” fixture containing health flags, inadvertently requiring an unconfigured Health-agent workspace. | Use the existing clean fixture for this environment-forwarding test. | Full suite passes after correcting the fixture. |

## Browser coverage

Engineering used the real local history: 13 runs, comprising 8 daily and 5 weekly runs. Checked daily and weekly selection, pipeline filtering, run search, run metadata and timeline, actual agent/model/target rows, PM log navigation and line filtering, daily and weekly HTML briefs, relative brief links, artifact search, and raw JSON preview.

Portfolio has no saved stocks runs on this Mac. Checked its real empty state and data-source instructions. A separate temporary data area and server supplied synthetic portfolio records for testing overview, native-currency book values, zero balances versus missing portfolios, holdings and recorded prices, attention items, escaping of names, briefs, artifacts, agent usage, and refresh after a step failure. Synthetic records were never placed in real run history.

The populated token example displayed 1,200 input + 80 output = 1,280 total, with 700 cache-read tokens as a subset of input. Real older engineering runs correctly showed “Not recorded.” Automated coverage includes retry totals, usage retained after worker/schema failures, partial totals, zero usage, malformed metadata, and missing usage.

No warnings or errors were returned by the browser log checks for the engineering and populated portfolio tabs. Visual inspection covered the available desktop panel layouts; a separate mobile-device/browser matrix was not run.

## Automated results

```sh
npm run typecheck
node --check dashboard/dashboard.js
node --check dashboard/portfolio.js
git diff --check
node --test --test-concurrency=4 'test/**/*.test.ts'
```

Final result: **336 tests total; 333 passed, 0 failed, 3 skipped**. Typecheck, JavaScript parsing, and whitespace checks passed.

The initial full run at default concurrency exposed the scheduled-test fixture issue and a worker test with a one-second timeout. That timeout test passed in isolation and in the final full run with four concurrent test files; its timing sensitivity under heavy parallel load remains a test limitation. No production timeout was changed.

Skipped coverage:

- Windows Task Scheduler argument parsing, because this check ran on macOS.
- Two external-schema checks, because the separate ash_new contract directory was unavailable at its configured path.

HTTP tests verify page/API separation, method rejection, local Host restrictions, path traversal and symlink protection, sandboxed HTML, relative artifact links, and large-log truncation.

## Limits and operating notes

No live financial pipeline, broker import, approval, or paid agent call was launched. Integration tests use temporary workspaces and worker/command stand-ins. Actual Windows execution and real portfolio records remain unverified here.

Historical token counts cannot be reconstructed when the original logs did not retain them. Unsupported workers show unavailable counts. Large logs are read from their last 1 MiB, with incomplete attempt/token coverage labelled as partial.

Both real dashboards remain served on port 4310. The temporary fixture server is stopped after verification. Startup and data connection instructions are in [dashboard.md](dashboard.md) and [portfolio-dashboard.md](portfolio-dashboard.md).
