# Book rules

The rules laid over every Book's Sleeves, as they stand from 11 November 2026 (Mandate `44a0f8162062`). Each Sleeve's own strategy is in [strategy-rules.md](strategy-rules.md); what changed and when is in [README.md](README.md).

## The Books

| | India | US | Hong Kong |
|---|---|---|---|
| Capital | ₹1 crore | $105,000 | HK$247,000 |
| Broker | ICICI Direct | moomoo | moomoo |
| Benchmark | Nifty 500 | S&P 500 | Hang Seng |
| Gold ETF | Kotak Gold ETF (`IN:GOLD1`) | SPDR Gold Shares (`US:GLD`) | `US:GLD`, in dollars |
| Cash fund | Liquid BeES (`IN:LIQUIDBEES`) | SPDR 1-3 Month T-Bill (`US:BIL`) | `US:BIL`, in dollars |
| Sleeves | Super 30 OK tuned, CW2 selected | CW2 selected, Super 30 OK tuned | CW2 selected, Super 30 OK tuned |
| Stage of each Sleeve | Paper | Paper | Paper |
| New money each year | 0 | 0 | 0 |

## What a Book holds

- **Sleeves:** each strategy has its own Sleeve, which follows the strategy's trades in whole shares (board lots in Hong Kong).
- **Sleeve weights:** inverse to each strategy's volatility over the past year, so the calmer strategy gets more.
- **When weights are set:** when a Book starts, and after that only by a yearly review that Saransh approves. A backtest sets them each April.
- **Gold:** 10% of the Book in its gold ETF, reset to 10% at each weighting.
- **Cash fund:** whatever no Sleeve is using. It earns the risk-free rate (6% in India, 3% in the US and Hong Kong in backtests).

## The Mandate

One Mandate for all three Books.

**Caps and order rules**

- **Position cap:** no buy takes one stock past 15% of the Book, counted across the Sleeves.
- **Sector cap:** no buy takes one sector past 30% of the Book.
- **Order-size guard:** a session's orders in a stock, on one side, stay within 1% of its 20-day average traded value.
- **Limit price:** a buy fills only at or under the last close plus 3%. A gap up past that buys nothing that session.

**Breakers**

- **First breaker:** none. Until 11 November 2026 it stopped new buys from a −10% drawdown until the Book was back above −5%.
- **Second breaker:** from a −18% drawdown, at most half the exposure level is in stocks, sold down at each open, until the Book is back above −9%.
- **Drawdown limit:** −25%. Nothing in the engine acts on it. The Candidate test judges a Book against it.
- **How drawdown is measured:** the Book's value per unit against its highest close, so new money neither hides nor deepens it.

**Disaster stops**

- **Distance under the entry:** twice the strategy's own stop distance, or 15% for a strategy without a stop.
- **Never inside the strategy's exit:** at least 10% past the strategy's own trailing stop.
- **Where that puts them:**

| Sleeve | Disaster stop under the entry |
|---|---|
| CW2 selected, India | 40% |
| CW2 selected, US | 30% |
| CW2 selected, Hong Kong | 50% |
| Super 30 OK tuned, each market | 35% |

- **Not raised:** a stop stays where it was set at the entry.
- **What a stop sells:** the whole holding, at the stop, or at the open when the price opens under it.
- **Risk per trade:** a position whose stop would lose more than 1% of the Book is flagged in the Brief. It is not blocked.

## The exposure level

The most of a Book that may be in stocks, set by its market's Market condition on the last close.

| Market condition | India | US | Hong Kong |
|---|---|---|---|
| Uptrend | 100% | 100% | 100% |
| Under pressure | 100% | 100% | 80% |
| Correction | 70% | 100% | 40% |

- **A buy over the level** is cut to the room left under it.
- **A Book over the level** sells its weakest holdings at the open: lowest RS Rating first, ties to the one closest to its Disaster stop.
- **Under the second breaker** the level is halved.
- **Gold** is outside the level.

## How the Market condition is read

Read for each market on every close, from its benchmark index.

- **Correction:** the index is under its 200-day average and breadth is under 40%; or there are 7 or more distribution days while the index is under its 50-day average.
- **Under pressure:** not a Correction, and the index is under its 50-day average or breadth is under 50%.
- **Uptrend:** neither.
- **Breadth:** the share of the index's members above their own 200-day average. For Hong Kong it is measured over stocks whose 20-day average traded value is at least HK$20M.
- **Distribution day:** the index falls 0.2% or more on more volume than the session before. They are counted over the last 25 sessions.

These thresholds are still placeholders, apart from the two set after the audit of 10 November 2026: distribution days count only under the 50-day average, and Hong Kong's breadth is over liquid stocks.

## The order the rules are applied in

Each order a Sleeve places at the open is asked of the Book first, the Sleeves in the order they are named, so the first named has first call on the room a cap leaves.

1. Quarantines and the Data gate: a Quarantined stock isn't traded, and on a day the Data gate fails only Disaster stops trade.
2. Stage scaling.
3. The second breaker.
4. The exposure level.
5. The position cap, then the sector cap.
6. The order-size guard.
7. The limit price.

What follows from that:

- **A cut buy is not retried.** The money waits in the cash fund until the strategy trades that stock again, or the next weighting.
- **A trimmed holding is not bought back** when the exposure level rises.
- **A stopped holding is bought again** only when its strategy trades it again.
- **What the second breaker sells is not bought back** when the Book recovers above −9%. Before 11 November the first breaker's recovery bought each Sleeve back to its strategy's weights; without it nothing does.

## Stages

A strategy's Stage sets how much of its share a real Book holds.

| Stage | In a real Book | In a paper Book |
|---|---|---|
| Paper | Nothing | Its full share |
| Real-small | A quarter of its share | Its full share |
| Real-full | All of its share | Its full share |

- **A Retired strategy** buys nothing more and sells each holding when its strategy does.
- **Promotions** are Saransh's to approve. Every Sleeve is at Paper today.

## The Playbook

The ranges the Portfolio Manager's judgement may move within, beside the Mandate. Placeholders until Saransh sets them.

- **Exposure:** it may cut a Book's exposure below the level, down to 80% in an Uptrend, 50% Under pressure and 0% in a Correction. Never above the level.
- **Size:** 0.5 to 1 times a strategy's own size.
- **Timing:** a buy may wait up to 5 sessions.
- **Rebalance:** no trade for a drift under 2% of the Book.
- **Moving a real Book to Playbook mode:** its paper Book must match its rules-only paper Book over 3 months, on return and on max drawdown.
