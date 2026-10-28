// Stages: where each strategy stands in a Book, as `pd stages` prints them (the glossary's Stage).
import type { PdSleeve } from './pd.ts'

/** A Stage as the glossary writes it: Candidate, Paper, Real-small, Real-full, Retired. */
export function stageName(stage: PdSleeve['stage']): string {
  const word = stage.replace('_', '-')
  return `${word.charAt(0).toUpperCase()}${word.slice(1)}`
}
