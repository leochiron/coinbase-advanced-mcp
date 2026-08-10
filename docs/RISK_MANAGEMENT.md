# Risk Management

## Hard policy

- Initial simulated capital: €1,000.
- Risk per trade: 1% of current equity.
- Maximum total exposure: 50%.
- Maximum single-asset exposure: 25%.
- Maximum positions: 3.
- Maximum leverage: 1x; leverage is not used.
- Maximum drawdown: 10%; then `RISK_HALT` and human review.

Size is calculated from filled entry to adverse stop after entry/exit fees, half-spread, and slippage. The smallest of risk units, asset capacity, portfolio capacity, and cash capacity wins. Quantity is rounded down and the estimated loss is rechecked.

Base costs per side are 10 bps fee, 1 bp half-spread, and 3 bps adverse slippage. High and severe scenarios are configured before testing in `config/research.json`.

BTC, ETH, and SOL are treated as correlated crypto-beta exposure. Three simultaneous 1%-risk positions are not assumed to be independent simply because the symbols differ.

The paper portfolio stores cash, positions, average entry, unrealized/realized P&L, fees, equity, peak, drawdown, status, and FX provenance. A paper proposal records no fill and changes no position.
