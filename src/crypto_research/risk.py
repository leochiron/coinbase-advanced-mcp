from __future__ import annotations

import math
from dataclasses import asdict
from typing import Any

from .models import PositionSizeResult, RiskPolicy, TradingCosts


def calculate_drawdown(current_equity: float, peak_equity: float) -> float:
    if peak_equity <= 0:
        raise ValueError("peak_equity must be positive")
    return max(0.0, (peak_equity - current_equity) / peak_equity)


def calculate_position_size(
    *,
    equity_eur: float,
    entry_usdt: float,
    stop_usdt: float,
    usdt_per_eur: float,
    current_total_exposure_eur: float = 0.0,
    current_asset_exposure_eur: float = 0.0,
    available_cash_eur: float | None = None,
    open_positions: int = 0,
    policy: RiskPolicy | None = None,
    costs: TradingCosts | None = None,
    quantity_step: float = 0.000001,
    minimum_notional_eur: float = 5.0,
) -> PositionSizeResult:
    risk_policy = policy or RiskPolicy()
    trading_costs = costs or TradingCosts()
    reasons: list[str] = []
    if equity_eur <= 0 or entry_usdt <= 0 or stop_usdt <= 0 or usdt_per_eur <= 0:
        raise ValueError("Equity, prices, and EUR/USDT conversion must be positive")
    if stop_usdt >= entry_usdt:
        raise ValueError("Long stop must be below entry")
    if risk_policy.max_leverage > 1.0:
        reasons.append("Configured leverage above the analysis-phase 1x ceiling is prohibited")
    if open_positions >= risk_policy.max_positions:
        reasons.append("Maximum simultaneous positions reached")

    adverse = trading_costs.adverse_bps_per_side / 10_000
    fee = trading_costs.fee_bps / 10_000
    entry_fill_eur = entry_usdt * (1 + adverse) / usdt_per_eur
    stop_fill_eur = stop_usdt * (1 - adverse) / usdt_per_eur
    per_unit_loss = (entry_fill_eur - stop_fill_eur) + entry_fill_eur * fee + stop_fill_eur * fee
    if per_unit_loss <= 0:
        raise ValueError("Stop and cost model do not produce positive per-unit risk")

    risk_amount = equity_eur * risk_policy.risk_per_trade
    risk_units = risk_amount / per_unit_loss
    asset_capacity = max(0.0, equity_eur * risk_policy.max_asset_exposure - current_asset_exposure_eur)
    total_capacity = max(0.0, equity_eur * risk_policy.max_total_exposure - current_total_exposure_eur)
    cash_capacity = max(0.0, available_cash_eur if available_cash_eur is not None else equity_eur)
    capacities = {
        "risk": risk_units,
        "single_asset_exposure": asset_capacity / entry_fill_eur,
        "total_portfolio_exposure": total_capacity / entry_fill_eur,
        "available_cash": cash_capacity / (entry_fill_eur * (1 + fee)),
    }
    binding = min(capacities, key=capacities.get)
    raw_units = min(capacities.values())
    units = math.floor(raw_units / quantity_step) * quantity_step if quantity_step > 0 else raw_units
    position_value = units * entry_fill_eur
    estimated_loss = units * per_unit_loss
    if units <= 0:
        reasons.append("No capacity remains after risk and exposure constraints")
    if position_value < minimum_notional_eur:
        reasons.append(f"Position value €{position_value:.2f} is below €{minimum_notional_eur:.2f} minimum")
    if estimated_loss > risk_amount + 1e-6:
        reasons.append("Rounded position exceeds the risk budget")

    return PositionSizeResult(
        allowed=not reasons,
        units=max(0.0, units),
        position_value_eur=max(0.0, position_value),
        risk_amount_eur=risk_amount,
        estimated_loss_at_stop_eur=max(0.0, estimated_loss),
        binding_constraint=binding,
        reasons=reasons,
    )


def calculate_long_trade_pnl(
    *,
    quantity: float,
    entry_price: float,
    exit_price: float,
    entry_fee: float,
    exit_fee: float,
) -> float:
    return quantity * (exit_price - entry_price) - entry_fee - exit_fee


def exposure_status(
    *,
    equity_eur: float,
    total_exposure_eur: float,
    asset_exposure_eur: float,
    open_positions: int,
    policy: RiskPolicy | None = None,
) -> dict[str, Any]:
    risk_policy = policy or RiskPolicy()
    total_pct = total_exposure_eur / equity_eur if equity_eur > 0 else float("inf")
    asset_pct = asset_exposure_eur / equity_eur if equity_eur > 0 else float("inf")
    breaches: list[str] = []
    if total_pct > risk_policy.max_total_exposure + 1e-12:
        breaches.append("MAX_TOTAL_EXPOSURE")
    if asset_pct > risk_policy.max_asset_exposure + 1e-12:
        breaches.append("MAX_ASSET_EXPOSURE")
    if open_positions > risk_policy.max_positions:
        breaches.append("MAX_POSITIONS")
    return {
        "status": "BREACH" if breaches else "OK",
        "total_exposure_pct": total_pct,
        "asset_exposure_pct": asset_pct,
        "open_positions": open_positions,
        "breaches": breaches,
        "policy": asdict(risk_policy),
    }
