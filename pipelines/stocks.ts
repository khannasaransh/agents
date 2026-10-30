import type { Pipeline } from '../src/pipeline.ts'

const stocks: Pipeline = {
  // Answers comes first, so what Saransh decided counts in this Run's refresh and Brief, then Broker
  // inbox records what he did at his brokers. Review (on Saturdays) follows the Lake, measuring the
  // refreshed Lake, and comes before Stages and Plan, so its demotions count in this Run's Stages and
  // Rule plans. Stages reads the Stages his Answers set. Plan follows Health, so the Corrections and
  // Quarantines it leaves count in the Rule plans; the Portfolio Manager judges the plans Plan made,
  // and Check holds its changes to the final check and records the Order lists. Save state applies
  // the Portfolio Manager's Journal and records the promotions it proposes. Brief comes last so its
  // Run health covers every other Step.
  steps: ['answers', 'broker-inbox', 'marketsmith', 'lake', 'review', 'stages', 'health', 'plan', 'portfolio-manager', 'check', 'save-state', 'brief'],
  brief: 'brief.html',
}

export default stocks
