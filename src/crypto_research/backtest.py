from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd

from .constants import TIMEFRAME_SECONDS, periods_per_year
from .indicators import add_indicators
from .models import BacktestResult, RiskPolicy, TradingCosts
from .regime import regime_labels
from .risk import calculate_position_size
from .strategies import StrategyDefinition


@dataclass
class _Position:
    quantity: float
    entry_index: int
    entry_time: pd.Timestamp
    entry_reference_usdt: float
    entry_fill_usdt: float
    entry_fill_eur: float
    entry_fee_eur: float
    stop_usdt: float
    target_usdt: float
    cash_before_eur: float
    risk_budget_eur: float
    entry_regime: str


def _exit_fill(reference_usdt: float, usdt_per_eur: float, costs: TradingCosts) -> tuple[float, float]:
    adverse = costs.adverse_bps_per_side / 10_000
    fill_usdt = reference_usdt * (1 - adverse)
    return fill_usdt, fill_usdt / usdt_per_eur


def _finite(value: float, fallback: float = 0.0) -> float:
    return float(value) if np.isfinite(value) else fallback


def run_backtest(
    frame: pd.DataFrame,
    strategy: StrategyDefinition,
    *,
    symbol: str,
    timeframe: str,
    segment: str = "full",
    initial_capital_eur: float = 1000.0,
    usdt_per_eur: float = 1.0,
    costs: TradingCosts | None = None,
    policy: RiskPolicy | None = None,
    params: dict[str, Any] | None = None,
    delayed_entry_bars: int = 0,
    trade_start_index: int = 250,
) -> BacktestResult:
    if len(frame) <= trade_start_index + 2:
        raise ValueError("Insufficient data after warm-up for backtest")
    if timeframe not in TIMEFRAME_SECONDS:
        raise ValueError(f"Unsupported timeframe: {timeframe}")
    if usdt_per_eur <= 0:
        raise ValueError("usdt_per_eur must be positive")
    trading_costs = costs or TradingCosts()
    risk_policy = policy or RiskPolicy()
    data = frame[["open", "high", "low", "close", "volume"]].astype(float).copy()
    signals = strategy.signals(data, params)
    labels = regime_labels(add_indicators(data))
    offset = 1 + delayed_entry_bars
    cash = initial_capital_eur
    position: _Position | None = None
    fees_paid = 0.0
    rejected_entries = 0
    risk_halt = False
    peak_equity = initial_capital_eur
    trades: list[dict[str, Any]] = []
    equity_records: list[dict[str, Any]] = [
        {"timestamp": data.index[trade_start_index - 1].isoformat(), "equity": initial_capital_eur}
    ]
    exposed_bars = 0
    evaluated_bars = 0

    def close_position(index: int, reference_usdt: float, reason: str) -> None:
        nonlocal cash, position, fees_paid
        assert position is not None
        fill_usdt, fill_eur = _exit_fill(reference_usdt, usdt_per_eur, trading_costs)
        exit_notional = position.quantity * fill_eur
        exit_fee = exit_notional * trading_costs.fee_bps / 10_000
        cash += exit_notional - exit_fee
        fees_paid += exit_fee
        pnl = cash - position.cash_before_eur
        holding_bars = index - position.entry_index + 1
        trades.append(
            {
                "entry_time": position.entry_time.isoformat(),
                "exit_time": data.index[index].isoformat(),
                "entry_price_usdt": position.entry_fill_usdt,
                "exit_price_usdt": fill_usdt,
                "stop_usdt": position.stop_usdt,
                "target_usdt": position.target_usdt,
                "quantity": position.quantity,
                "pnl_eur": pnl,
                "fees_eur": position.entry_fee_eur + exit_fee,
                "holding_bars": holding_bars,
                "holding_hours": holding_bars * TIMEFRAME_SECONDS[timeframe] / 3600,
                "exit_reason": reason,
                "entry_regime": position.entry_regime,
                "risk_budget_eur": position.risk_budget_eur,
                "r_multiple": pnl / position.risk_budget_eur if position.risk_budget_eur else 0.0,
            }
        )
        position = None

    for i in range(trade_start_index, len(data)):
        evaluated_bars += 1
        row = data.iloc[i]
        signal_index = i - offset
        exited_this_bar = False

        if position is not None:
            held = i - position.entry_index
            signal_exit = signal_index >= 0 and bool(signals.exit.iloc[signal_index])
            if signal_exit:
                close_position(i, float(row["open"]), "signal")
                exited_this_bar = True
            elif held >= signals.max_holding_bars:
                close_position(i, float(row["open"]), "time_stop")
                exited_this_bar = True
            elif float(row["open"]) <= position.stop_usdt:
                close_position(i, float(row["open"]), "stop_gap")
                exited_this_bar = True
            elif float(row["open"]) >= position.target_usdt:
                close_position(i, float(row["open"]), "target_gap")
                exited_this_bar = True
            else:
                stop_touched = float(row["low"]) <= position.stop_usdt
                target_touched = float(row["high"]) >= position.target_usdt
                if stop_touched:
                    # If both levels occur in one OHLC bar, use the adverse outcome.
                    close_position(i, position.stop_usdt, "stop")
                    exited_this_bar = True
                elif target_touched:
                    close_position(i, position.target_usdt, "target")
                    exited_this_bar = True

        if position is None and not exited_this_bar and not risk_halt and signal_index >= 0:
            if bool(signals.entry.iloc[signal_index]):
                atr_value = float(signals.atr.iloc[signal_index])
                reference_entry = float(row["open"])
                if np.isfinite(atr_value) and atr_value > 0:
                    stop_usdt = reference_entry - atr_value * signals.stop_atr_multiple
                    if stop_usdt > 0:
                        sizing = calculate_position_size(
                            equity_eur=cash,
                            entry_usdt=reference_entry,
                            stop_usdt=stop_usdt,
                            usdt_per_eur=usdt_per_eur,
                            available_cash_eur=cash,
                            policy=risk_policy,
                            costs=trading_costs,
                            minimum_notional_eur=0.01,
                        )
                        if sizing.allowed and sizing.units > 0:
                            adverse = trading_costs.adverse_bps_per_side / 10_000
                            entry_fill_usdt = reference_entry * (1 + adverse)
                            entry_fill_eur = entry_fill_usdt / usdt_per_eur
                            entry_fee = sizing.units * entry_fill_eur * trading_costs.fee_bps / 10_000
                            cash_before = cash
                            cash -= sizing.units * entry_fill_eur + entry_fee
                            fees_paid += entry_fee
                            risk_distance = reference_entry - stop_usdt
                            target_usdt = reference_entry + signals.take_profit_r * risk_distance
                            position = _Position(
                                quantity=sizing.units,
                                entry_index=i,
                                entry_time=data.index[i],
                                entry_reference_usdt=reference_entry,
                                entry_fill_usdt=entry_fill_usdt,
                                entry_fill_eur=entry_fill_eur,
                                entry_fee_eur=entry_fee,
                                stop_usdt=stop_usdt,
                                target_usdt=target_usdt,
                                cash_before_eur=cash_before,
                                risk_budget_eur=sizing.risk_amount_eur,
                                entry_regime=str(labels.iloc[signal_index]),
                            )
                        else:
                            rejected_entries += 1

        if position is not None:
            exposed_bars += 1
            equity = cash + position.quantity * float(row["close"]) / usdt_per_eur
        else:
            equity = cash
        peak_equity = max(peak_equity, equity)
        drawdown = (peak_equity - equity) / peak_equity if peak_equity else 0.0
        if drawdown >= risk_policy.max_drawdown:
            risk_halt = True
        equity_records.append({"timestamp": data.index[i].isoformat(), "equity": equity})

    if position is not None:
        close_position(len(data) - 1, float(data["close"].iloc[-1]), "end_of_test")
        equity_records[-1]["equity"] = cash

    equity = pd.Series(
        [record["equity"] for record in equity_records],
        index=pd.to_datetime([record["timestamp"] for record in equity_records], utc=True),
        dtype=float,
    )
    returns = equity.pct_change().dropna()
    total_return = equity.iloc[-1] / initial_capital_eur - 1
    elapsed_days = max((equity.index[-1] - equity.index[0]).total_seconds() / 86400, 1 / 24)
    cagr = (equity.iloc[-1] / initial_capital_eur) ** (365.25 / elapsed_days) - 1 if equity.iloc[-1] > 0 else -1.0
    annualization = periods_per_year(timeframe)
    standard = returns.std(ddof=0)
    sharpe = returns.mean() / standard * np.sqrt(annualization) if standard > 0 else 0.0
    downside = returns[returns < 0]
    downside_std = downside.std(ddof=0)
    sortino = returns.mean() / downside_std * np.sqrt(annualization) if downside_std > 0 else 0.0
    drawdowns = equity / equity.cummax() - 1
    max_drawdown = abs(float(drawdowns.min()))
    pnls = np.array([trade["pnl_eur"] for trade in trades], dtype=float)
    wins = pnls[pnls > 0]
    losses = pnls[pnls < 0]
    if len(trades) == 0:
        profit_factor = 0.0
    elif len(losses) == 0:
        profit_factor = 999.0
    else:
        profit_factor = float(wins.sum() / abs(losses.sum())) if len(wins) else 0.0
    return BacktestResult(
        strategy=strategy.name,
        strategy_version=strategy.version,
        symbol=symbol,
        timeframe=timeframe,
        segment=segment,
        start=equity.index[0].isoformat(),
        end=equity.index[-1].isoformat(),
        total_return=_finite(total_return),
        annualized_return=_finite(cagr),
        cagr=_finite(cagr),
        sharpe_ratio=_finite(sharpe),
        sortino_ratio=_finite(sortino),
        max_drawdown=_finite(max_drawdown),
        profit_factor=_finite(profit_factor),
        win_rate=float(len(wins) / len(trades)) if trades else 0.0,
        average_winner=float(wins.mean()) if len(wins) else 0.0,
        average_loser=float(losses.mean()) if len(losses) else 0.0,
        expectancy=float(pnls.mean()) if len(pnls) else 0.0,
        trades=len(trades),
        market_exposure=exposed_bars / evaluated_bars if evaluated_bars else 0.0,
        average_holding_hours=float(np.mean([t["holding_hours"] for t in trades])) if trades else 0.0,
        fees_paid=fees_paid,
        ending_equity=float(equity.iloc[-1]),
        rejected_entries=rejected_entries,
        trade_log=trades,
        equity_curve=equity_records,
    )


def run_chronological_splits(
    frame: pd.DataFrame,
    strategy: StrategyDefinition,
    *,
    symbol: str,
    timeframe: str,
    initial_capital_eur: float,
    usdt_per_eur: float,
    costs: TradingCosts,
    policy: RiskPolicy,
    params: dict[str, Any] | None = None,
    delayed_entry_bars: int = 0,
    warmup: int = 250,
) -> dict[str, BacktestResult]:
    length = len(frame)
    train_end = int(length * 0.60)
    validation_end = int(length * 0.80)
    if train_end <= warmup + 20 or validation_end - train_end < 50 or length - validation_end < 50:
        raise ValueError("Dataset is too short for 60/20/20 chronological splits")
    segments = {
        "train": (frame.iloc[:train_end], warmup),
        "validation": (frame.iloc[max(0, train_end - warmup) : validation_end], min(warmup, train_end)),
        "test": (frame.iloc[max(0, validation_end - warmup) :], min(warmup, validation_end)),
    }
    return {
        name: run_backtest(
            segment_frame,
            strategy,
            symbol=symbol,
            timeframe=timeframe,
            segment=name,
            initial_capital_eur=initial_capital_eur,
            usdt_per_eur=usdt_per_eur,
            costs=costs,
            policy=policy,
            params=params,
            delayed_entry_bars=delayed_entry_bars,
            trade_start_index=start_index,
        )
        for name, (segment_frame, start_index) in segments.items()
    }


def monte_carlo_trade_sequences(
    trade_log: list[dict[str, Any]], initial_capital_eur: float = 1000.0, simulations: int = 1000, seed: int = 42
) -> dict[str, Any]:
    if not trade_log:
        return {"simulations": simulations, "trades": 0, "return_p05": None, "median_return": None, "drawdown_p95": None}
    pnls = np.array([float(trade["pnl_eur"]) for trade in trade_log])
    rng = np.random.default_rng(seed)
    returns: list[float] = []
    drawdowns: list[float] = []
    for _ in range(simulations):
        sample = rng.choice(pnls, size=len(pnls), replace=True)
        curve = initial_capital_eur + np.concatenate(([0.0], np.cumsum(sample)))
        peaks = np.maximum.accumulate(curve)
        dd = np.max((peaks - curve) / np.maximum(peaks, 1e-9))
        returns.append(curve[-1] / initial_capital_eur - 1)
        drawdowns.append(float(dd))
    return {
        "simulations": simulations,
        "trades": len(pnls),
        "return_p05": float(np.percentile(returns, 5)),
        "median_return": float(np.median(returns)),
        "return_p95": float(np.percentile(returns, 95)),
        "drawdown_p95": float(np.percentile(drawdowns, 95)),
        "seed": seed,
    }


def walk_forward_validation(
    frame: pd.DataFrame,
    strategy: StrategyDefinition,
    *,
    symbol: str,
    timeframe: str,
    initial_capital_eur: float,
    usdt_per_eur: float,
    costs: TradingCosts,
    policy: RiskPolicy,
    folds: int = 3,
    warmup: int = 250,
) -> dict[str, Any]:
    length = len(frame)
    first_test = int(length * 0.40)
    remaining = length - first_test
    fold_size = remaining // folds
    results: list[dict[str, Any]] = []
    for fold in range(folds):
        test_start = first_test + fold * fold_size
        test_end = length if fold == folds - 1 else test_start + fold_size
        slice_start = max(0, test_start - warmup)
        fold_frame = frame.iloc[slice_start:test_end]
        trade_start = test_start - slice_start
        result = run_backtest(
            fold_frame, strategy, symbol=symbol, timeframe=timeframe, segment=f"walk_forward_{fold + 1}",
            initial_capital_eur=initial_capital_eur, usdt_per_eur=usdt_per_eur, costs=costs,
            policy=policy, trade_start_index=trade_start,
        )
        results.append(result.to_dict())
    passes = sum(item["expectancy"] > 0 and item["profit_factor"] > 1 for item in results)
    return {"folds": results, "pass_ratio": passes / folds if folds else 0.0, "method": "expanding chronological OOS folds"}


def performance_by_entry_regime(trade_log: list[dict[str, Any]]) -> dict[str, Any]:
    groups: dict[str, list[float]] = {}
    for trade in trade_log:
        groups.setdefault(str(trade["entry_regime"]), []).append(float(trade["pnl_eur"]))
    return {
        regime: {
            "trades": len(pnls),
            "expectancy_eur": float(np.mean(pnls)),
            "total_pnl_eur": float(np.sum(pnls)),
            "win_rate": float(np.mean(np.array(pnls) > 0)),
        }
        for regime, pnls in groups.items()
    }
