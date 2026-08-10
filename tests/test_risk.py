import pytest

from crypto_research.models import RiskPolicy, TradingCosts
from crypto_research.risk import (
    calculate_drawdown,
    calculate_long_trade_pnl,
    calculate_position_size,
    exposure_status,
)


def test_position_size_stays_within_one_percent_risk_and_exposure():
    result = calculate_position_size(
        equity_eur=1000,
        entry_usdt=100,
        stop_usdt=95,
        usdt_per_eur=1.2,
        available_cash_eur=1000,
        policy=RiskPolicy(),
        costs=TradingCosts(fee_bps=10, half_spread_bps=1, slippage_bps=3),
        quantity_step=0.000001,
    )
    assert result.allowed
    assert result.estimated_loss_at_stop_eur <= 10.0 + 1e-6
    assert result.position_value_eur <= 250.0 + 1e-6


def test_position_size_rejects_invalid_long_stop():
    with pytest.raises(ValueError):
        calculate_position_size(equity_eur=1000, entry_usdt=100, stop_usdt=101, usdt_per_eur=1.0)


def test_pnl_fees_and_drawdown():
    assert calculate_long_trade_pnl(
        quantity=2, entry_price=100, exit_price=110, entry_fee=0.2, exit_fee=0.22
    ) == pytest.approx(19.58)
    assert calculate_drawdown(900, 1000) == pytest.approx(0.10)


def test_exposure_limits_detect_breaches():
    status = exposure_status(
        equity_eur=1000, total_exposure_eur=501, asset_exposure_eur=251, open_positions=4
    )
    assert status["status"] == "BREACH"
    assert set(status["breaches"]) == {"MAX_TOTAL_EXPOSURE", "MAX_ASSET_EXPOSURE", "MAX_POSITIONS"}
