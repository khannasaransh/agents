import type { Pipeline } from '../src/pipeline.ts'

const stocks: Pipeline = {
  // Answers comes first, so what Saransh decided counts in this Run's refresh and Brief, then Broker
  // inbox records what he did at his brokers. Review (on Saturdays) follows the Lake, measuring the
  // refreshed Lake, and comes before Stages and Plan, so its demotions count in this Run's Stages and
  // Rule plans. Stages reads the Stages his Answers set. Plan follows Health, so the Corrections and
  // Quarantines it leaves count in the Rule plans; Feeds follows Plan, fetching for the names its plan
  // asks the Desk to review, and the Desk reviews them with their Feeds; the Portfolio Manager judges
  // the plans Plan made with the Desk's views, and Check holds its changes to the final check and
  // records the Order lists. Save state applies the Portfolio Manager's Journal and records the
  // promotions it proposes. Brief follows every Step it reports on, so its Run health covers them.
  // Backtests alone comes after it: it runs the stale backtests the Lake Step left out, which took
  // most of a Run and which nothing in the Brief reads, so the Brief is ready before Hong Kong opens
  // (the audit of 10 November 2026, docs/audit).
  steps: ['answers', 'broker-inbox', 'marketsmith', 'lake', 'review', 'stages', 'health', 'plan', 'feeds', 'desk', 'portfolio-manager', 'check', 'save-state', 'sash', 'brief', 'backtests'],
  brief: 'brief.html',
}

export default stocks
