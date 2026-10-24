# The stocks Pipeline owns the Lake's Schedule

ash_new can schedule its own refreshes: its API runs the daily chain at 07:30 and 19:00 IST, and `pd schedule-task install` registers a Windows task for when the API is closed. Both are turned off. Only the stocks Pipeline refreshes the Lake on a Schedule, calling `pd daily` as one of its Steps. The Portfolio Manager must decide only on data that its own Run refreshed and that its Data gate checked. A refresh started by ash_new would race the Run for the refresh lock, and the Run couldn't clear, retry or diagnose (with the Health Agent) a refresh it didn't start.

## Considered Options

- **ash_new schedules and the stocks Pipeline follows it**: rejected. The Pipeline would have to poll ash_new's job records to learn that a refresh had finished, and a failed refresh would show up only as a stale Data gate, with no diagnosis.
- **Both schedule**: rejected. `pd daily --task` already stands down while the API's schedule is on, because two refreshes can't share the Lake.

## Consequences

- ash_new's schedule stays off and its Task Scheduler task stays removed. The stocks Pipeline's Lake Step raises a To-do if it finds ash_new's schedule on.
- A refresh started by hand from ash_new's Data page still works. The next Run's Data gate checks whatever that refresh left behind.
