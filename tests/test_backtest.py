import numpy as np
import pandas as pd
import pytest

from crypto_research.backtest import run_backtest
from crypto_research.models import RiskPolicy, TradingCosts
from crypto_research.strategies import SignalSet, StrategyDefinition


def test_signals_fill_at_next_bar_open_without_lookahead():
    rows = 320
    index = pd.date_range("2025-01-01", periods=rows, freq="h", tz="UTC")
    opens = np.full(rows, 100.0)
    opens[256] = 105.0
    opens[258] = 110.0
    frame = pd.DataFrame({
        "open": opens,
        "high": opens + 0.25,
        "low": opens - 0.25,
        "close": opens,
        "volume": 1000.0,
    }, index=index)

    def builder(data, params):
        entry = pd.Series(False, index=data.index)
        exit_signal = pd.Series(False, index=data.index)
        entry.iloc[255] = True
        exit_signal.iloc[257] = True
        atr_line = pd.Series(1.0, index=data.index)
        return SignalSet(entry, exit_signal, atr_line, 10.0, 10.0, 100)

    strategy = StrategyDefinition(
        name="test", version="1", style="test", hypothesis="test", reason="test",
        expected_failure_mode="test", entry_rule="test", exit_rule="test", stop_rule="test",
        invalidation_rule="test", compatible_regimes=("neutral",), default_params={},
        signal_builder=builder, sensitivity_variants=(),
    )
    result = run_backtest(
        frame, strategy, symbol="BTC/USDT", timeframe="1h", trade_start_index=250,
        costs=TradingCosts(fee_bps=0, half_spread_bps=0, slippage_bps=0),
        policy=RiskPolicy(), usdt_per_eur=1.0,
    )
    assert result.trades == 1
    trade = result.trade_log[0]
    assert trade["entry_time"] == index[256].isoformat()
    assert trade["entry_price_usdt"] == 105.0
    assert trade["exit_time"] == index[258].isoformat()
    assert trade["exit_price_usdt"] == 110.0
    assert result.fees_paid == 0
