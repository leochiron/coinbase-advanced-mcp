# Risk Policy

These are hard defaults for the €1,000 simulated portfolio:

- Risk per trade: 1% of current equity (€10 at inception).
- Total exposure: 50% maximum.
- Single-asset exposure: 25% maximum.
- Simultaneous positions: three maximum.
- Leverage: 1x maximum; no leverage in initial research.
- Portfolio drawdown halt: 10% from peak equity.

Calculate size from the stop, including both-side fees, spread, and slippage:

```text
risk_amount = current_equity × 0.01
per_unit_loss = adverse_entry - adverse_stop + entry_fee + stop_exit_fee
risk_units = risk_amount / per_unit_loss
final_units = minimum(risk_units, asset cap, portfolio cap, available cash)
```

Round down to instrument precision and reject values below minimum notional. Confirm the estimated stop loss does not exceed the risk budget after rounding.

At 10% drawdown, set `RISK_HALT`, open no new positions, investigate strategy behavior, and require human review. Never increase risk after recent gains. Never convert the 1% loss budget into a 1% position-size rule.

For EUR accounting, divide USDT values by the time-stamped EUR/USDT spot rate. Backtests use the retrieved current rate as a fixed conversion for position accounting and disclose that historical FX variation is not modeled; percentage performance is unaffected by a constant conversion.
