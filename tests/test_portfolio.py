import json

from crypto_research.models import TradingCosts
from crypto_research.portfolio import PAPER_MODE, PaperPortfolio


def test_paper_portfolio_persists_and_never_claims_execution(tmp_path):
    portfolio = PaperPortfolio(tmp_path / "portfolio.json", tmp_path / "ledger.jsonl")
    state = portfolio.initialize(1000)
    assert state["mode"] == PAPER_MODE
    proposal = portfolio.propose_long(
        symbol="BTC/USDT", entry_usdt=100, stop_usdt=95, usdt_per_eur=1.0,
        strategy="test",
    )
    assert proposal["status"] == "PROPOSAL_ONLY"
    assert proposal["mode"] == PAPER_MODE
    persisted = json.loads((tmp_path / "portfolio.json").read_text())
    assert persisted["positions"] == []


def test_simulated_open_and_close_are_reproducible_paper_events(tmp_path):
    portfolio = PaperPortfolio(tmp_path / "portfolio.json", tmp_path / "ledger.jsonl")
    portfolio.initialize(1000)
    zero_costs = TradingCosts(fee_bps=0, half_spread_bps=0, slippage_bps=0)
    opened = portfolio.simulate_open_long(
        symbol="BTC/USDT", reference_price_usdt=100, stop_usdt=95, usdt_per_eur=1.0,
        strategy="test", timestamp="2025-01-01T00:00:00Z", costs=zero_costs,
    )
    assert portfolio.load()["positions"][0]["position_id"] == opened["position_id"]
    closed = portfolio.simulate_close_long(
        position_id=opened["position_id"], reference_price_usdt=110, usdt_per_eur=1.0,
        timestamp="2025-01-02T00:00:00Z", reason="target", costs=zero_costs,
    )
    state = portfolio.load()
    assert closed["mode"] == PAPER_MODE
    assert closed["realized_pnl_eur"] > 0
    assert state["positions"] == []
    assert "SIMULATED_OPEN_FILL" in (tmp_path / "ledger.jsonl").read_text()
    assert "SIMULATED_CLOSE_FILL" in (tmp_path / "ledger.jsonl").read_text()
