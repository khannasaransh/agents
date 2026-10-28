import type { Pipeline } from '../src/pipeline.ts'

const weekly: Pipeline = {
  // The same brief as the daily Pipeline, over the week rather than the day. It keeps its own
  // cursors, so it doesn't move the daily Pipeline's, and it doesn't update the wiki.
  steps: ['fetch', 'review', 'discord', 'branches', 'pm', 'save-state', 'brief'],
  // The page to open; brief.md beside it holds the same in Markdown.
  brief: 'brief.html',
}

export default weekly
