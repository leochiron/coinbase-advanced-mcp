import numpy as np
import pandas as pd

from crypto_research.strategies import STRATEGIES


def make_prices(rows: int = 500) -> pd.DataFrame:
    index = pd.date_range("2025-01-01", periods=rows, freq="h", tz="UTC")
    close = pd.Series(100 + np.linspace(0, 50, rows) + np.sin(np.arange(rows) / 5), index=index)
    return pd.DataFrame({
        "open": close.shift(1).fillna(close.iloc[0]),
        "high": close + 1,
        "low": close - 1,
        "close": close,
        "volume": 1000 + (np.arange(rows) % 17) * 10,
    }, index=index)


def test_all_baselines_emit_boolean_rules_with_matching_index():
    frame = make_prices()
    for strategy in STRATEGIES:
        signals = strategy.signals(frame)
        assert signals.entry.index.equals(frame.index)
        assert signals.exit.index.equals(frame.index)
        assert signals.entry.dtype == bool
        assert signals.exit.dtype == bool
        assert signals.stop_atr_multiple > 0
        assert signals.take_profit_r >= 2


def test_future_mutation_does_not_change_prior_signals():
    frame = make_prices()
    cutoff = 400
    for strategy in STRATEGIES:
        before = strategy.signals(frame).entry.iloc[:cutoff].copy()
        mutated = frame.copy()
        mutated.iloc[cutoff:, mutated.columns.get_loc("close")] *= 5
        after = strategy.signals(mutated).entry.iloc[:cutoff]
        pd.testing.assert_series_equal(before, after)
