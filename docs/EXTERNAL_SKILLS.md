# External Skill Security Review

Review date: 2026-08-10.

## Installed environment

The installed Codex catalog was scanned for crypto, OHLCV, technical analysis, quantitative finance, backtesting, vectorbt, pandas, statistics, risk, CCXT, DeFi, and on-chain skills. No installed skill owned this workflow. The Investment Banking plugin was read and rejected for use because its scope explicitly excludes non-banker investment decisions. `skill-creator` was used to initialize and validate the project skill; `skill-installer` guidance was read, but no external pack was globally installed.

## AGIPro claude-trading-skills

Repository: https://github.com/agiprolabs/claude-trading-skills

- Reviewed commit: `938a6ee84eed8f2b51cfb5055eaaddc8c596028d`.
- License: MIT.
- Structure: 67 skill directories covering analysis, APIs, DeFi, execution, taxes, and quantitative research; no repository-level Python dependency manifest.
- Useful reviewed skills: `ohlcv-processing`, `regime-detection`, `strategy-framework`, `walk-forward-validation`, `risk-management`, `position-sizing`, `portfolio-analytics`, `slippage-modeling`, and `correlation-analysis`.
- Security finding: the repository also includes DEX execution, transaction-building, wallet, copy-trading, MEV, and authenticated API capabilities. The OHLCV example can interpolate spikes and fill gaps, which conflicts with this project’s fail-closed evidence policy.
- Decision: do not install the pack. Adapt only transparent concepts—canonical OHLCV schema, regime axes, written strategy contracts, chronological validation, cost awareness, fixed-fractional stop sizing, and correlation limits—into independently tested project code.

## VelonLabs MASTER-Trading-Skills

Repository: https://github.com/velonone/MASTER-Trading-Skills

- Reviewed commit: `db2acf202148c941128cfc16f49249ffecf70ee8`.
- License: MIT.
- Dependencies: numpy, pandas, pydantic, structlog, tenacity, PyYAML; optional CCXT, Web3, eth-account, TDA, evolutionary, and security packages.
- Useful concepts: typed contracts and strict next-bar open fills.
- Blocking findings: the pack exposes CCXT `create_order`/`cancel_order`, API credentials, Web3 private-key signing and raw transaction broadcast. Its dynamic drawdown check is a placeholder returning false, position sizing is signal-strength/capital based rather than stop-risk based, and performance annualization assumes daily observations.
- Setup risk: its setup scripts install development plus security tooling and pre-commit hooks; they were inspected but not executed.
- Decision: do not install or vendor it. Reimplement the safe next-bar and typed-contract concepts without any execution seam.

No external script was executed and no third-party code was copied wholesale. Attribution is retained here for the adapted design concepts.
