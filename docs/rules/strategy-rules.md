# Strategy rules

Each Sleeve's own strategy, as the versions the Books hold on 11 November 2026 trade. The Book's rules over them are in [book-rules.md](book-rules.md). None of these changed on 11 November.

A strategy runs on its own and never sees the Book's rules. It decides on each session's close and trades at the next session's open.

## What each Book holds

| Book | Sleeve | Strategy id | Version | Stage |
|---|---|---|---|---|
| India | Super 30 OK tuned | `in-super30-ok-tuned` | `b0a30c3545e3` | Paper |
| India | CW2 selected | `in-cw2-selected` | `c9dcf1a57075` | Paper |
| US | CW2 selected | `us-cw2-selected` | `e4878b26b11a` | Paper |
| US | Super 30 OK tuned | `us-super30-ok-tuned` | `85bd4c575e9a` | Paper |
| Hong Kong | CW2 selected | `hk-cw2-selected` | `e44090f83899` | Paper |
| Hong Kong | Super 30 OK tuned | `hk-super30-ok-tuned` | `b636d72a81b3` | Paper |

## CW2 selected

A weekly breakout from a tight range, bought into a fixed number of slots and held until a stop sells it.

**What it buys**

- **The signal:** on weekly bars, the Bollinger band (50 weeks) is narrower than 8 times the 50-week ATR, and the week closes above the upper band.
- **Daily trend:** the stock's daily SuperTrend (10 bars, 2 ATRs) is up.
- **Which first:** candidates are ranked 80% by relative strength over 55 sessions and 20% by their share of up days over 63 sessions.
- **How much:** each buy gets the Sleeve's cash divided by its free slots.
- **When:** only while the market's index has closed above its 200-day average five sessions in a row.

**What it sells**

- **Stop-loss:** a close this far under the buy price.
- **Trailing stop:** a close this far under the highest close since the buy.
- **Market exit:** everything, when the index closes this far under its 200-day average.

**Settings by market**

| | India | US | Hong Kong |
|---|---|---|---|
| Slots | 8 | 8 | 16 |
| Stop-loss | 10% | 10% | 25% |
| Trailing stop | 30% | 20% | 30% |
| Market index | Nifty 500 | S&P 500 | Hang Seng |
| Market exit, under the 200-day average | 5% | 3% | 5% |
| Least traded value a day (50-bar average) | ₹5 crore | $200M | HK$200M |
| Least price | ₹20 | $5 | HK$1 |
| Most circuit days in the last 20 sessions | 2 | not tested | not tested |
| Relative strength measured against | Nifty 50 | S&P 500 | Hang Seng |

A stock that fell by more than half in one session in the last ten years is never bought.

## Super 30 OK tuned

A fundamentals screen, bought into 12 slots, strongest first, and held until a stop sells it.

**What it buys**

- **The screen, India:** return on equity and return on capital employed of 7% or more, and EPS and sales growth over 7% on the year before in three of the last four quarters.
- **The screen, US:** the same, with ROIC standing in for ROCE and sales estimated from asset turnover, because the US data has neither.
- **The screen, Hong Kong:** the same, with return on assets of 7% or more standing in for ROCE, and growth over 7% in both of the last two halves, because Hong Kong companies report by halves.
- **Missing figures:** a value not reported passes no test. Fund holders are not tested, because the data has no history of them.
- **Which first:** the strongest by relative strength against the market's index.
- **When:** only while the market's index has closed above its 200-day average five sessions in a row.

**What it sells**

- **Stop-loss:** a close 15% under the buy price.
- **Trailing stop:** a close 25% under the highest close since the buy.
- **Market exit:** everything, when the index closes 5% under its 200-day average.

**Settings by market**

| | India | US | Hong Kong |
|---|---|---|---|
| Slots | 12 | 12 | 12 |
| Market index | Nifty 500 | S&P 500 | Hang Seng |
| Least traded value a day | ₹5 crore | $20M | HK$10M |
| Least price | ₹20 | $5 | HK$1 |
| Most circuit days in the last 20 sessions | 2 | not tested | not tested |
| Relative strength measured against | Nifty 50 | S&P 500 | Hang Seng |

## Strategies proposed, not held

From the studies of 11 November 2026. None is in a Book.

- **Low Volatility 30** (`us-low-volatility-30`, `hk-low-volatility-30`): the 30 calmest of the 300 largest stocks, weighted inverse to volatility, rebalanced each quarter, with no stop and no market exit.
- **Momentum tuned** (`us-momentum-tuned`): proposed with Low Volatility 30 for the US Book in place of Super 30 OK tuned.
- **Steady Leaders** (`in-steady-leaders`): proposed for India in place of Super 30 OK tuned.

Their rules are in each plugin file in portfolio-dashboard (`plugins/`), and what they measured is in the two study pages in [docs/audit/strategies](../audit/strategies/).
