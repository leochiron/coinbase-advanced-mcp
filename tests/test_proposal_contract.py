from crypto_research.proposal_contract import build_research_decision


def _base_report():
    source = {
        "source": "test-provider",
        "exchange": "test-exchange",
        "retrieved_at": "2026-01-01T12:01:00Z",
        "cache_sha256": "a" * 64,
    }
    quality = {
        "sources": {"15m": source},
        "latest_closed_candles": {"15m": "2026-01-01T11:59:59Z"},
    }
    asset = {
        "step_1_data_quality": quality,
        "step_5_15m_entry_refinement": {"price": 100.0},
        "step_6_regime": {"volatility": "normal"},
    }
    return {
        "analysis_timestamp": "2026-01-01T12:02:00Z",
        "mode": "PAPER_ANALYSIS_ONLY",
        "decision": "NO TRADE",
        "proposal": None,
        "no_trade": {"reasons": ["No eligible strategy"]},
        "fx": {"usdt_per_eur": 1.25},
        "assets": {"BTC/USDT": asset},
    }


def test_no_trade_is_a_versioned_auditable_artifact():
    artifact = build_research_decision(_base_report())
    assert artifact["schemaVersion"] == "1.0.0"
    assert artifact["decision"] == "NO_TRADE"
    assert artifact["orderIntent"] is None
    assert artifact["marketPricesEur"]["BTC-EUR"] == "80"
    assert artifact["bridgePolicy"]["liveExecutionAuthorized"] is False


def test_long_maps_to_paper_only_eur_limit_intent():
    report = _base_report()
    report["decision"] = "LONG"
    report["no_trade"] = None
    report["proposal"] = {
        "asset": "BTC/USDT",
        "strategy": "ema-trend",
        "timeframe": "1h",
        "signal_candle": "2026-01-01T10:59:59Z",
        "confidence": "MEDIUM",
        "maximum_risk_eur": 10.0,
        "estimated_loss_at_stop_eur": 9.5,
        "position_value_eur": 200.0,
        "position_size_units": 2.0,
        "entry_zone_usdt": [99.0, 101.0],
        "take_profit_1_usdt": 110.0,
        "stop_loss_usdt": 95.0,
        "sizing_allowed": True,
        "market_regime": {"trend": "bullish"},
    }
    artifact = build_research_decision(report)
    assert artifact["decision"] == "LONG"
    assert artifact["orderIntent"] == {
        "productId": "BTC-EUR",
        "side": "BUY",
        "orderType": "LIMIT",
        "baseSize": "2",
        "limitPrice": "80.8",
        "takeProfitPrice": "88",
        "stopLossPrice": "76",
        "timeInForce": "GTC",
    }
    assert artifact["research"]["strategyEligible"] is True
