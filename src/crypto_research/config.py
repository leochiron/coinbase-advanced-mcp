from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .models import RiskPolicy, TradingCosts


@dataclass(frozen=True)
class Settings:
    project_root: Path
    universe: tuple[str, ...]
    timeframes: tuple[str, ...]
    bars_by_timeframe: dict[str, int]
    provider: str
    initial_capital_eur: float
    costs: TradingCosts
    high_costs: TradingCosts
    severe_costs: TradingCosts
    risk: RiskPolicy
    acceptance: dict[str, float]

    @property
    def data_dir(self) -> Path:
        return self.project_root / "data"

    @property
    def reports_dir(self) -> Path:
        return self.project_root / "reports"


def _costs(data: dict[str, Any]) -> TradingCosts:
    return TradingCosts(
        fee_bps=float(data["fee_bps"]),
        half_spread_bps=float(data["half_spread_bps"]),
        slippage_bps=float(data["slippage_bps"]),
    )


def load_settings(project_root: Path | str | None = None) -> Settings:
    root = Path(project_root or Path.cwd()).resolve()
    config_path = root / "config" / "research.json"
    raw = json.loads(config_path.read_text(encoding="utf-8"))
    risk = raw["risk"]
    return Settings(
        project_root=root,
        universe=tuple(raw["universe"]),
        timeframes=tuple(raw["timeframes"]),
        bars_by_timeframe={k: int(v) for k, v in raw["bars_by_timeframe"].items()},
        provider=str(raw["provider"]),
        initial_capital_eur=float(raw["initial_capital_eur"]),
        costs=_costs(raw["costs"]["base"]),
        high_costs=_costs(raw["costs"]["high"]),
        severe_costs=_costs(raw["costs"]["severe"]),
        risk=RiskPolicy(
            risk_per_trade=float(risk["risk_per_trade"]),
            max_total_exposure=float(risk["max_total_exposure"]),
            max_asset_exposure=float(risk["max_asset_exposure"]),
            max_positions=int(risk["max_positions"]),
            max_leverage=float(risk["max_leverage"]),
            max_drawdown=float(risk["max_drawdown"]),
        ),
        acceptance={k: float(v) for k, v in raw["acceptance_gate"].items()},
    )
