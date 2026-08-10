from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime, timedelta
from typing import Any

from .io_utils import atomic_write_json


SCHEMA_VERSION = "1.0.0"
SCHEMA_NAME = "crypto-research-decision"
PAPER_MODE = "PAPER_ANALYSIS_ONLY"


def _parse_timestamp(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)


def _decimal(value: float, places: int = 8) -> str:
    rendered = f"{value:.{places}f}".rstrip("0").rstrip(".")
    return rendered if rendered and float(rendered) > 0 else "0"


def _source_evidence(report: dict[str, Any]) -> tuple[list[dict[str, str]], dict[str, str]]:
    evidence: list[dict[str, str]] = []
    prices: dict[str, str] = {}
    usdt_per_eur = float(report["fx"]["usdt_per_eur"])
    for symbol, asset in sorted(report["assets"].items()):
        for timeframe, source in sorted(asset["step_1_data_quality"]["sources"].items()):
            evidence.append(
                {
                    "symbol": symbol,
                    "timeframe": timeframe,
                    "provider": str(source["source"]),
                    "exchange": str(source["exchange"]),
                    "retrievedAt": str(source["retrieved_at"]),
                    "sha256": str(source["cache_sha256"]),
                    "latestClosedCandle": str(
                        asset["step_1_data_quality"]["latest_closed_candles"][timeframe]
                    ),
                }
            )
        current_usdt = float(asset["step_5_15m_entry_refinement"]["price"])
        prices[symbol.replace("/USDT", "-EUR")] = _decimal(current_usdt / usdt_per_eur)
    return evidence, prices


def _expiry(generated_at: datetime, timeframe: str | None) -> datetime:
    lifetime = {"15m": timedelta(minutes=30), "1h": timedelta(minutes=90), "4h": timedelta(hours=6)}
    return generated_at + lifetime.get(timeframe or "", timedelta(minutes=30))


def build_research_decision(report: dict[str, Any]) -> dict[str, Any]:
    """Build the only artifact the TypeScript paper bridge is allowed to consume."""
    if report.get("mode") != PAPER_MODE:
        raise ValueError("Research report must remain PAPER_ANALYSIS_ONLY")

    generated_at = _parse_timestamp(str(report["analysis_timestamp"]))
    proposal = report.get("proposal") if report.get("decision") == "LONG" else None
    timeframe = str(proposal["timeframe"]) if proposal else None
    evidence, market_prices_eur = _source_evidence(report)
    closed_candle = (
        str(proposal["signal_candle"])
        if proposal
        else max(item["latestClosedCandle"] for item in evidence if item["timeframe"] == "15m")
    )
    strategy = str(proposal["strategy"]) if proposal else None
    product_id = str(proposal["asset"]).replace("/USDT", "-EUR") if proposal else None
    normalized_decision = "LONG" if proposal else "NO_TRADE"
    dedupe_material = "|".join(
        [SCHEMA_VERSION, normalized_decision, product_id or "NONE", strategy or "NONE", closed_candle]
    )
    dedupe_key = hashlib.sha256(dedupe_material.encode("utf-8")).hexdigest()
    artifact_id = f"research_{dedupe_key[:24]}"

    order_intent: dict[str, Any] | None = None
    research: dict[str, Any] | None = None
    if proposal:
        usdt_per_eur = float(report["fx"]["usdt_per_eur"])
        order_intent = {
            "productId": product_id,
            "side": "BUY",
            "orderType": "LIMIT",
            "baseSize": _decimal(float(proposal["position_size_units"])),
            "limitPrice": _decimal(float(proposal["entry_zone_usdt"][1]) / usdt_per_eur),
            "takeProfitPrice": _decimal(float(proposal["take_profit_1_usdt"]) / usdt_per_eur),
            "stopLossPrice": _decimal(float(proposal["stop_loss_usdt"]) / usdt_per_eur),
            "timeInForce": "GTC",
        }
        research = {
            "asset": proposal["asset"],
            "strategy": proposal["strategy"],
            "strategyEligible": True,
            "timeframe": proposal["timeframe"],
            "signalCandle": proposal["signal_candle"],
            "confidence": proposal["confidence"],
            "maximumRiskEur": proposal["maximum_risk_eur"],
            "estimatedLossAtStopEur": proposal["estimated_loss_at_stop_eur"],
            "positionValueEur": proposal["position_value_eur"],
            "sizingAllowed": proposal["sizing_allowed"],
            "marketRegime": proposal["market_regime"],
        }

    extreme_volatility = any(
        asset["step_6_regime"]["volatility"] == "extreme" for asset in report["assets"].values()
    )
    no_trade_reasons = (report.get("no_trade") or {}).get("reasons", [])
    artifact = {
        "schemaName": SCHEMA_NAME,
        "schemaVersion": SCHEMA_VERSION,
        "artifactId": artifact_id,
        "dedupeKey": dedupe_key,
        "generatedAt": generated_at.isoformat().replace("+00:00", "Z"),
        "expiresAt": _expiry(generated_at, timeframe).isoformat().replace("+00:00", "Z"),
        "closedCandleAt": closed_candle,
        "mode": PAPER_MODE,
        "decision": normalized_decision,
        "dataStatus": "PASS",
        "orderIntent": order_intent,
        "research": research,
        "risk": {
            "halt": False,
            "extremeVolatility": extreme_volatility,
            "maximumRiskEur": proposal["maximum_risk_eur"] if proposal else 0.0,
            "estimatedLossAtStopEur": proposal["estimated_loss_at_stop_eur"] if proposal else 0.0,
        },
        "marketPricesEur": market_prices_eur,
        "noTradeReasons": no_trade_reasons,
        "sourceEvidence": evidence,
        "bridgePolicy": {
            "paperOnly": True,
            "requiresStoredDryRun": True,
            "liveExecutionAuthorized": False,
            "requiresInstrumentRoundingBeforeLive": True,
        },
    }
    return artifact


def write_research_decision(report: dict[str, Any], path: Any) -> dict[str, Any]:
    artifact = build_research_decision(report)
    # Round-trip now so a consumer sees exactly the JSON structure tested here.
    json.dumps(artifact, allow_nan=False)
    atomic_write_json(path, artifact)
    return artifact
