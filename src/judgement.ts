// The Portfolio Manager's judgement as the Stocks Brief words it: each Judgement mode, each change
// from the Rule plan with its Decision record in plain sentences, and each proposal waiting on Saransh.
import type { PdDecisionRecord, PdJudgedChange, PdJudgementMode, PdJudgementProposal, PdPlanOrder } from './pd.ts'
import { percent } from './plans.ts'

const modes: Record<PdJudgementMode, string> = { plan_only: 'plan only', subtract_only: 'subtract only', playbook: 'Playbook' }

/** A Judgement mode as the glossary writes it: plan only, subtract only, Playbook. */
export const modeName = (mode: PdJudgementMode) => modes[mode]

const named = (order: Pick<PdPlanOrder, 'security_id' | 'name'>) => (order.name ? `${order.name} (${order.security_id})` : order.security_id)
const whole = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 })

/** What a change did, in a sentence's words: "Dropped the buy of 2,415 Stove Kraft Ltd (IN:STOVEKRAFT)". */
export function changeText(change: PdJudgedChange): string {
  const rule = change.rule_order
  const made = change.orders[0]
  const ruled = rule ? `${whole(rule.shares)} ${named(rule)}` : (change.order ?? 'an order')
  switch (change.kind) {
    case 'exposure':
      return `Set the exposure level at ${percent(change.level ?? 0)}${change.orders.length ? `, trimming or cutting ${change.orders.length} orders` : ''}${change.dropped?.length ? ` and taking out ${change.dropped.length} buys` : ''}`
    case 'drop':
      return `Dropped the buy of ${ruled}`
    case 'resize':
      return `Resized the buy of ${ruled} to ${change.multiple}×${made ? `: ${whole(made.shares)} shares` : ''}`
    case 'swap':
      return `Swapped the buy of ${ruled} for ${made ? `${whole(made.shares)} ${named(made)}` : (change.security_id ?? 'another name')}`
    case 'wait':
      return `Held back the buy of ${ruled} up to ${change.sessions} sessions`
    case 'release':
      return `Bought ${made ? `${whole(made.shares)} ${named(made)}` : 'a buy'} that waited (wait ${change.wait})`
    case 'trim':
      return `Trimmed ${made ? `${whole(made.shares)} ${named(made)}` : (change.security_id ?? 'a holding')} in the ${change.sleeve} Sleeve`
    case 'skip':
      return `Skipped the rebalance of ${ruled}`
  }
}

/** A Decision record in plain sentences. */
export function decisionText(decision: PdDecisionRecord): string {
  const figures = decision.figures.map((f) => `${f.field} ${f.security === null ? '' : `of ${f.security} `}${JSON.stringify(f.value)} (${f.input})`)
  return [
    `The Rule plan: ${sentence(decision.rule_plan)}`,
    `Instead: ${sentence(decision.instead)}`,
    `Its Lever is ${decision.lever}, within the Playbook's "${decision.playbook}".`,
    figures.length ? `It read ${figures.join('; ')}.` : 'It cites no figure.',
    `Expected: ${sentence(decision.expected)}`,
    `Judged on ${decision.judged_on}.`,
  ].join(' ')
}

/** Text as a sentence: ending in a full stop unless it ends in one already. */
export const sentence = (text: string) => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`)

/** What a proposal would change: "Move the India Book's paper Book into plan only", "Set the India Book's Playbook's size_max to 1.25". */
export function proposalText(proposal: PdJudgementProposal, bookName: string): string {
  if (proposal.mode) return `Move the ${bookName}'s ${proposal.paper ? 'paper Book' : 'real Book'} into ${modeName(proposal.mode)} mode`
  const ranges = Object.entries(proposal.playbook ?? {}).map(([name, value]) => `${name} to ${value}`)
  return `Set the ${bookName}'s Playbook's ${ranges.join(', ')}`
}
