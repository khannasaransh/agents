# The rules the Books trade under

What is in force for the India, US and Hong Kong Books, in one place. The config files in `D:\Saransh\backend\portfolio-dashboard` are the source: when a rule changes there, these pages change with it.

| Page | What it holds |
|---|---|
| [book-rules.md](book-rules.md) | The Mandate, the exposure level and how the Market condition is read, how the Book engine applies them, the Stages and the Playbook |
| [strategy-rules.md](strategy-rules.md) | Each Sleeve's own strategy: what it buys, its stops and when it sells everything |

## In force

- **Mandate:** version `44a0f8162062`, from 11 November 2026, the same for all three Books.
- **Exposure levels:** set per Book on 11 November 2026.
- **Sleeves:** two strategies in each Book, all at the Paper Stage, so only the paper Books trade them today.

| Source | What it sets |
|---|---|
| `config/books.yaml` | Each Book's capital, gold ETF, cash fund, Mandate, exposure levels and Playbook |
| `config/market_condition.yaml` | The thresholds that read Uptrend, Under pressure and Correction |
| `config/approved_versions.yaml` | The strategy versions approved for the Candidate test |
| `plugins/*.py` | Each strategy's own rules |
| `src/pdash/portfolios/book_engine.py` | The order the rules are applied in |

## Changes

### 11 November 2026

Saransh's word, after the study of the same day ([CAGR at a Sharpe floor](../audit/strategies/2026-11-11-cagr-at-sharpe-floor.html)).

| Book | Rule | Before | Now |
|---|---|---|---|
| All | First breaker | No new buys from a −10% drawdown until back above −5% | Dropped |
| India | Exposure level (Uptrend / Under pressure / Correction) | 100% / 80% / 40% | 100% / 100% / 70% |
| US | Exposure level | 100% / 80% / 40% | 100% / 100% / 100% |
| Hong Kong | Exposure level | 100% / 80% / 40% | Unchanged |

Everything else is as it was, the second breaker included. The Mandate's version went from `7d9f896c659f` to `44a0f8162062`.

**Why.** A buy that a rule cuts is never retried. Once a Book fell 10% the first breaker stopped its buys, and the money stayed in the cash fund long after buys resumed. The exposure level hid this by keeping the Book away from −10%. Over the ten years to November 2026 the US Book held 62% of itself idle.

**What it measured**, each Book with the Sleeves it holds today (CAGR / Sharpe ratio / max drawdown):

| Book | Window | Before | Now |
|---|---|---|---|
| India | Ten years to November 2026 | 22.4% / 1.28 / −13.1% | 25.0% / 1.24 / −14.5% |
| India | Holdout, 2013 to 2016 | 25.3% / 1.68 / −7.3% | 29.3% / 1.67 / −10.1% |
| India | Frozen panels, 2009 to 2016 | 19.4% / 1.14 / −10.9% | 20.9% / 1.14 / −19.2% |
| US | Ten years | 8.7% / 0.57 / −16.4% | 13.8% / 0.76 / −19.9% |
| US | Holdout | 4.8% / 0.37 / −3.3% | 5.4% / 0.46 / −3.5% |
| Hong Kong | Ten years | 12.2% / 0.88 / −13.0% | 7.6% / 0.51 / −19.1% |
| Hong Kong | Holdout | 1.2% / −0.20 / −12.8% | 1.9% / −0.11 / −12.8% |

The "Now" column is each Book run as the config stands after the change (`docs/review/cagr-20261111/as_configured.py` in portfolio-dashboard, output in `as-configured.txt`). The US Book can't run on the frozen panels with Super 30 OK tuned, which needs sales estimates they don't have.

**The US Book is still under a Sharpe ratio of 0.8** with the Sleeves it holds. The Sleeves proposed below would put it at 1.00.

**Hong Kong is worse without the first breaker** over the ten years and about the same in the holdout. It was dropped there with the others at Saransh's word. Its exposure level was left as it was. With the first breaker gone, 100% / 100% / 70% would have measured 10.5% / 0.69 / −19.6% over the ten years and 1.6% / −0.12 / −16.8% in the holdout. Both Hong Kong Sleeves are at Paper.

**What the code needed.** The Mandate can now be without a first breaker (`pdash.core.books.Mandate`), the engine never stops buys under one, and `pd paper-books` and `pd review` print `null` for its level. The Stocks Brief then shows one breaker, not two.

**Proposed in the study, not applied:**

- **US Sleeves:** CW2 selected, Low Volatility 30 and Momentum tuned in place of CW2 selected and Super 30 OK tuned. With the rules as they now are that Book measured 15.3% / 1.00 / −13.2% over the ten years. It needs `us-low-volatility-30` (`446fa769f5d3`) approved.
- **India:** Steady Leaders (`2740347b82d5`) in place of Super 30 OK tuned, which raised the Sharpe ratio, not the CAGR.
- **Hong Kong:** Low Volatility 30 (`8e787915dc49`) added, which cut the drawdown, not the CAGR.

### 10 November 2026

The audit ([portfolio pipeline audit](../audit/2026-11-10-portfolio-pipeline-audit.html)) made the Mandate's second version, `7d9f896c659f`:

- **Disaster stops** are never nearer than 10% past the strategy's own trailing stop, and are no longer raised each week.
- **Distribution days** count toward the Market condition only while the index is under its 50-day average.
- **Hong Kong's breadth** is measured over stocks trading at least HK$20M a day, not over every listing.

### 31 October 2026

Saransh confirmed the first Mandate (`f99c88f13b5b`) and each Book's capital.
