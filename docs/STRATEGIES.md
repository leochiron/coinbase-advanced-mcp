# Baseline Strategies

All strategies are versioned, deterministic, long/flat, and enter at the next open after a closed-candle signal. Full machine-readable definitions live in `src/crypto_research/strategies.py`.

| Strategy                 | Entry summary                                                | Exit summary                   |    Stop | Target |
| ------------------------ | ------------------------------------------------------------ | ------------------------------ | ------: | -----: |
| EMA trend                | EMA20 crosses above EMA50, price above EMA200, volume ≥ MA20 | Bearish EMA recross            |   2 ATR |     3R |
| RSI mean reversion       | RSI recovers above 30, price above EMA200, ADX < 25          | RSI ≥ 52 or EMA200 failure     | 1.5 ATR |     2R |
| Donchian breakout        | Close above prior 20-bar high, volume > 1.1× MA              | Close below prior 10-bar low   |   2 ATR |     4R |
| MACD momentum            | Positive MACD cross, EMA50 > EMA200, RSI 45–70               | Bearish MACD recross           |   2 ATR |     3R |
| Bollinger mean reversion | Close re-enters lower band, RSI < 40, ADX < 22               | Middle band or ADX expansion   | 1.5 ATR |     2R |
| Trend + pullback         | EMA20 > EMA50 > EMA200, EMA20 touch/reclaim, RSI 45–62       | EMA50 failure or bearish cross | 1.8 ATR |     3R |

Every strategy also has a time stop and an explicit expected failure mode. Strategy hypotheses, reasons, rules, parameters, and tests are written to the evaluation artifact before eligibility is determined.

Indicators are evidence, not independent votes. The current decision first selects strategies that survived historical validation, then tests regime compatibility, then inspects the latest closed signal.
