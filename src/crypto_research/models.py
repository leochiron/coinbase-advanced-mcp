from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass(frozen=True)
class TradingCosts:
    fee_bps: float = 10.0
    half_spread_bps: float = 1.0
    slippage_bps: float = 3.0

    @property
    def adverse_bps_per_side(self) -> float:
        return self.half_spread_bps + self.slippage_bps

    def to_dict(self) -> dict[str, float]:
        return asdict(self)


@dataclass(frozen=True)
class RiskPolicy:
    risk_per_trade: float = 0.01
    max_total_exposure: float = 0.50
    max_asset_exposure: float = 0.25
    max_positions: int = 3
    max_leverage: float = 1.0
    max_drawdown: float = 0.10


@dataclass
class ValidationResult:
    status: str
    symbol: str
    timeframe: str
    rows: int
    first_timestamp: str | None
    latest_closed_candle: str | None
    missing_candles: int = 0
    duplicate_timestamps: int = 0
    inconsistent_intervals: int = 0
    impossible_candles: int = 0
    zero_volume_candles: int = 0
    incomplete_candles: int = 0
    stale: bool = False
    timezone: str = "UTC"
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return self.status == "PASS"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

@dataclass
class BacktestResult:
    strategy: str
    strategy_version: str
    symbol: str
    timeframe: str
    segment: str
    start: str
    end: str
    total_return: float
    annualized_return: float
    cagr: float
    sharpe_ratio: float
    sortino_ratio: float
    max_drawdown: float
    profit_factor: float
    win_rate: float
    average_winner: float
    average_loser: float
    expectancy: float
    trades: int
    market_exposure: float
    average_holding_hours: float
    fees_paid: float
    ending_equity: float
    rejected_entries: int
    trade_log: list[dict[str, Any]] = field(default_factory=list, repr=False)
    equity_curve: list[dict[str, Any]] = field(default_factory=list, repr=False)

    def to_dict(self, include_series: bool = False) -> dict[str, Any]:
        payload = asdict(self)
        if not include_series:
            payload.pop("trade_log", None)
            payload.pop("equity_curve", None)
        return payload


@dataclass
class PositionSizeResult:
    allowed: bool
    units: float
    position_value_eur: float
    risk_amount_eur: float
    estimated_loss_at_stop_eur: float
    binding_constraint: str
    reasons: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
