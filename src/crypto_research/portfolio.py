from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .io_utils import append_jsonl, atomic_write_json, iso_utc
from .models import RiskPolicy, TradingCosts
from .risk import calculate_drawdown, calculate_long_trade_pnl, calculate_position_size

PAPER_MODE = "PAPER_ANALYSIS_ONLY"


def initial_portfolio(initial_capital_eur: float = 1000.0) -> dict[str, Any]:
    now = iso_utc()
    return {
        "schema_version": "1.0",
        "mode": PAPER_MODE,
        "status": "ACTIVE",
        "base_currency": "EUR",
        "created_at": now,
        "updated_at": now,
        "initial_capital_eur": initial_capital_eur,
        "cash_eur": initial_capital_eur,
        "positions": [],
        "realized_pnl_eur": 0.0,
        "unrealized_pnl_eur": 0.0,
        "fees_eur": 0.0,
        "equity_eur": initial_capital_eur,
        "peak_equity_eur": initial_capital_eur,
        "drawdown": 0.0,
        "fx": {
            "pair": "EUR/USDT",
            "usdt_per_eur": None,
            "retrieved_at": None,
            "methodology": "USDT values are divided by EUR/USDT to obtain EUR.",
        },
    }


class PaperPortfolio:
    def __init__(self, state_path: Path, ledger_path: Path, policy: RiskPolicy | None = None):
        self.state_path = state_path
        self.ledger_path = ledger_path
        self.policy = policy or RiskPolicy()

    def initialize(self, initial_capital_eur: float = 1000.0, overwrite: bool = False) -> dict[str, Any]:
        if self.state_path.exists() and not overwrite:
            return self.load()
        state = initial_portfolio(initial_capital_eur)
        atomic_write_json(self.state_path, state)
        append_jsonl(self.ledger_path, {"event": "PORTFOLIO_INITIALIZED", "timestamp": iso_utc(), "state": state})
        return state

    def load(self) -> dict[str, Any]:
        if not self.state_path.exists():
            return self.initialize()
        state = json.loads(self.state_path.read_text(encoding="utf-8"))
        if state.get("mode") != PAPER_MODE:
            raise RuntimeError("Portfolio mode is not PAPER_ANALYSIS_ONLY; refusing operation")
        return state

    def _save(self, state: dict[str, Any], event: dict[str, Any]) -> None:
        state["updated_at"] = iso_utc()
        atomic_write_json(self.state_path, state)
        append_jsonl(self.ledger_path, {"timestamp": state["updated_at"], **event})

    def mark_to_market(self, prices_usdt: dict[str, float], usdt_per_eur: float, fx_timestamp: str) -> dict[str, Any]:
        state = self.load()
        unrealized = 0.0
        exposure = 0.0
        for position in state["positions"]:
            symbol = position["symbol"]
            if symbol not in prices_usdt:
                raise ValueError(f"Missing mark price for {symbol}")
            mark_eur = prices_usdt[symbol] / usdt_per_eur
            position["mark_price_usdt"] = prices_usdt[symbol]
            position["unrealized_pnl_eur"] = position["quantity"] * (mark_eur - position["average_entry_eur"])
            position["position_value_eur"] = position["quantity"] * mark_eur
            unrealized += position["unrealized_pnl_eur"]
            exposure += position["position_value_eur"]
        state["unrealized_pnl_eur"] = unrealized
        state["equity_eur"] = state["cash_eur"] + exposure
        state["peak_equity_eur"] = max(state["peak_equity_eur"], state["equity_eur"])
        state["drawdown"] = calculate_drawdown(state["equity_eur"], state["peak_equity_eur"])
        state["status"] = "RISK_HALT" if state["drawdown"] >= self.policy.max_drawdown else state.get("status", "ACTIVE")
        state["fx"] = {
            "pair": "EUR/USDT", "usdt_per_eur": usdt_per_eur, "retrieved_at": fx_timestamp,
            "methodology": "USDT values are divided by EUR/USDT to obtain EUR.",
        }
        self._save(state, {"event": "MARK_TO_MARKET", "equity_eur": state["equity_eur"], "drawdown": state["drawdown"]})
        return state

    def propose_long(
        self,
        *,
        symbol: str,
        entry_usdt: float,
        stop_usdt: float,
        usdt_per_eur: float,
        strategy: str,
        costs: TradingCosts | None = None,
    ) -> dict[str, Any]:
        state = self.load()
        if state["status"] == "RISK_HALT":
            return {"allowed": False, "reasons": ["Portfolio is RISK_HALT"], "mode": PAPER_MODE}
        total_exposure = sum(float(p.get("position_value_eur", 0)) for p in state["positions"])
        asset_exposure = sum(float(p.get("position_value_eur", 0)) for p in state["positions"] if p["symbol"] == symbol)
        sizing = calculate_position_size(
            equity_eur=state["equity_eur"], entry_usdt=entry_usdt, stop_usdt=stop_usdt,
            usdt_per_eur=usdt_per_eur, current_total_exposure_eur=total_exposure,
            current_asset_exposure_eur=asset_exposure, available_cash_eur=state["cash_eur"],
            open_positions=len(state["positions"]), policy=self.policy, costs=costs,
        )
        proposal = {
            "proposal_id": f"PAPER-{iso_utc().replace(':', '').replace('-', '')}",
            "created_at": iso_utc(),
            "mode": PAPER_MODE,
            "symbol": symbol,
            "direction": "LONG",
            "strategy": strategy,
            "entry_usdt": entry_usdt,
            "stop_usdt": stop_usdt,
            "sizing": sizing.to_dict(),
            "status": "PROPOSAL_ONLY",
            "warning": "This proposal cannot route an order and does not create a position.",
        }
        append_jsonl(self.ledger_path, {"event": "PAPER_PROPOSAL", **proposal})
        return proposal

    def simulate_open_long(
        self,
        *,
        symbol: str,
        reference_price_usdt: float,
        stop_usdt: float,
        usdt_per_eur: float,
        strategy: str,
        timestamp: str,
        costs: TradingCosts | None = None,
    ) -> dict[str, Any]:
        """Record an explicit simulated fill. This method has no exchange route."""
        state = self.load()
        if state["status"] == "RISK_HALT":
            raise RuntimeError("Portfolio is RISK_HALT")
        trading_costs = costs or TradingCosts()
        total_exposure = sum(float(p.get("position_value_eur", 0)) for p in state["positions"])
        asset_exposure = sum(float(p.get("position_value_eur", 0)) for p in state["positions"] if p["symbol"] == symbol)
        sizing = calculate_position_size(
            equity_eur=state["equity_eur"], entry_usdt=reference_price_usdt, stop_usdt=stop_usdt,
            usdt_per_eur=usdt_per_eur, current_total_exposure_eur=total_exposure,
            current_asset_exposure_eur=asset_exposure, available_cash_eur=state["cash_eur"],
            open_positions=len(state["positions"]), policy=self.policy, costs=trading_costs,
        )
        if not sizing.allowed:
            raise RuntimeError(f"Simulated fill rejected by risk policy: {sizing.reasons}")
        adverse = trading_costs.adverse_bps_per_side / 10_000
        fill_usdt = reference_price_usdt * (1 + adverse)
        fill_eur = fill_usdt / usdt_per_eur
        notional_eur = sizing.units * fill_eur
        entry_fee = notional_eur * trading_costs.fee_bps / 10_000
        if notional_eur + entry_fee > state["cash_eur"] + 1e-9:
            raise RuntimeError("Simulated fill exceeds cash")
        position_id = f"PAPER-POS-{timestamp.replace(':', '').replace('-', '')}-{len(state['positions']) + 1}"
        position = {
            "position_id": position_id,
            "symbol": symbol,
            "direction": "LONG",
            "strategy": strategy,
            "opened_at": timestamp,
            "quantity": sizing.units,
            "average_entry_usdt": fill_usdt,
            "average_entry_eur": fill_eur,
            "reference_entry_usdt": reference_price_usdt,
            "stop_usdt": stop_usdt,
            "entry_fee_eur": entry_fee,
            "mark_price_usdt": fill_usdt,
            "position_value_eur": notional_eur,
            "unrealized_pnl_eur": 0.0,
            "mode": PAPER_MODE,
        }
        state["cash_eur"] -= notional_eur + entry_fee
        state["positions"].append(position)
        state["fees_eur"] += entry_fee
        state["equity_eur"] = state["cash_eur"] + sum(float(p["position_value_eur"]) for p in state["positions"])
        state["drawdown"] = calculate_drawdown(state["equity_eur"], state["peak_equity_eur"])
        if state["drawdown"] >= self.policy.max_drawdown:
            state["status"] = "RISK_HALT"
        state["fx"] = {
            "pair": "EUR/USDT", "usdt_per_eur": usdt_per_eur, "retrieved_at": timestamp,
            "methodology": "USDT values are divided by EUR/USDT to obtain EUR.",
        }
        self._save(state, {"event": "SIMULATED_OPEN_FILL", "position": position, "costs": trading_costs.to_dict()})
        return position

    def simulate_close_long(
        self,
        *,
        position_id: str,
        reference_price_usdt: float,
        usdt_per_eur: float,
        timestamp: str,
        reason: str,
        costs: TradingCosts | None = None,
    ) -> dict[str, Any]:
        """Close one simulated position and append a reproducible paper event."""
        state = self.load()
        index = next((i for i, p in enumerate(state["positions"]) if p["position_id"] == position_id), None)
        if index is None:
            raise KeyError(f"Unknown paper position: {position_id}")
        trading_costs = costs or TradingCosts()
        position = state["positions"][index]
        adverse = trading_costs.adverse_bps_per_side / 10_000
        exit_fill_usdt = reference_price_usdt * (1 - adverse)
        exit_fill_eur = exit_fill_usdt / usdt_per_eur
        proceeds = position["quantity"] * exit_fill_eur
        exit_fee = proceeds * trading_costs.fee_bps / 10_000
        pnl = calculate_long_trade_pnl(
            quantity=position["quantity"], entry_price=position["average_entry_eur"],
            exit_price=exit_fill_eur, entry_fee=position["entry_fee_eur"], exit_fee=exit_fee,
        )
        state["cash_eur"] += proceeds - exit_fee
        state["fees_eur"] += exit_fee
        state["realized_pnl_eur"] += pnl
        state["positions"].pop(index)
        state["unrealized_pnl_eur"] = sum(float(p.get("unrealized_pnl_eur", 0)) for p in state["positions"])
        state["equity_eur"] = state["cash_eur"] + sum(float(p.get("position_value_eur", 0)) for p in state["positions"])
        state["peak_equity_eur"] = max(state["peak_equity_eur"], state["equity_eur"])
        state["drawdown"] = calculate_drawdown(state["equity_eur"], state["peak_equity_eur"])
        if state["drawdown"] >= self.policy.max_drawdown:
            state["status"] = "RISK_HALT"
        fill = {
            "position_id": position_id,
            "symbol": position["symbol"],
            "closed_at": timestamp,
            "reference_exit_usdt": reference_price_usdt,
            "exit_fill_usdt": exit_fill_usdt,
            "exit_fee_eur": exit_fee,
            "realized_pnl_eur": pnl,
            "reason": reason,
            "mode": PAPER_MODE,
        }
        self._save(state, {"event": "SIMULATED_CLOSE_FILL", "fill": fill, "costs": trading_costs.to_dict()})
        return fill


def realized_pnl_for_fill(
    quantity: float, entry_price_eur: float, exit_price_eur: float, entry_fee_eur: float, exit_fee_eur: float
) -> float:
    return calculate_long_trade_pnl(
        quantity=quantity, entry_price=entry_price_eur, exit_price=exit_price_eur,
        entry_fee=entry_fee_eur, exit_fee=exit_fee_eur,
    )
