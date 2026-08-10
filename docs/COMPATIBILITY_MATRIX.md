# V1 Compatibility Matrix

This matrix is the release gate for the hybrid v2 line. A v2 change is not
compatible when it removes, renames, weakens, or silently changes one of these
v1 capabilities.

| V1 capability                         | V2 owner        | Compatibility requirement                                                        | Automated evidence                      |
| ------------------------------------- | --------------- | -------------------------------------------------------------------------------- | --------------------------------------- |
| MCP stdio startup                     | TypeScript      | Remains the default transport; stdout stays reserved for MCP                     | Build, lint, server tests               |
| Coinbase account/product/ticker reads | TypeScript      | Existing tool names and authenticated client routes remain unchanged             | Coinbase client and compatibility tests |
| Portfolio snapshot and allocation     | TypeScript      | Existing public inputs and result semantics remain available                     | Portfolio/allocation tests              |
| Limit and stop-limit proposals        | TypeScript      | Persist before execution; payload validation remains strict                      | Proposal/validation tests               |
| Dry-run creation                      | TypeScript      | Produces no Coinbase request and remains auditable                               | Proposal and execution-lock tests       |
| Live execution                        | TypeScript only | Requires live switch, stored proposal/dry-run, and exact `CONFIRM_EXECUTE_ORDER` | Execution-lock tests                    |
| Live cancellation                     | TypeScript only | Requires live switch and exact `CONFIRM_CANCEL_ORDER`                            | Cancellation tests                      |
| Audit and local history               | TypeScript      | Existing tables remain additive-migration compatible                             | Audit tests and migration-on-open       |
| Manual paper trading                  | TypeScript      | Existing confirmation-based workflow remains supported                           | Legacy paper/execution tests            |
| Paper portfolio reset                 | TypeScript      | Exact confirmation remains required                                              | Existing MCP tool contract              |
| Knowledge registry                    | TypeScript      | Explicit `CONFIRM_ADD_SOURCE` remains required                                   | Knowledge tests                         |
| Two-step watcher                      | TypeScript/Node | Duplicate protection and confirmations remain unchanged                          | Build plus watcher dry-run procedure    |
| PHP remote guard                      | PHP             | Deployment stays separate and live confirmations remain mandatory                | Unchanged source/deployment boundary    |
| No withdrawals/transfers              | Both            | No route, tool, client method, or adapter may add them                           | Architecture review and source scan     |

## New v2 capabilities and isolation

| Capability                                      | Authority                                  | Can reach Coinbase order endpoints? |
| ----------------------------------------------- | ------------------------------------------ | ----------------------------------- |
| Public market research and backtests            | Python                                     | No                                  |
| Versioned research decision artifact            | Python                                     | No                                  |
| Artifact validation and proposal/dry-run import | TypeScript bridge                          | No                                  |
| Continuous research scheduler                   | TypeScript runner + sanitized Python child | No                                  |
| Automatic paper submission                      | TypeScript `PaperBrokerService` only       | No                                  |
| Paper TP/SL, partial fills, P&L and reports     | TypeScript local SQLite                    | No                                  |

The automated research path deliberately does not depend on
`OrderExecutionService` or `CoinbaseClient.createOrder`. Enabling live Coinbase
trading therefore does not turn research automation into live automation.

## Release gate

A v2 branch may be merged only when:

1. every legacy tool name in `LEGACY_TOOL_REGISTRY` is still present;
2. all historical TypeScript tests pass;
3. bridge, automation, paper and failure-mode tests pass;
4. all Python tests and the end-to-end public-data workflow pass;
5. live confirmation strings and default-off switches are unchanged;
6. the source scan finds no Python credential/order route and no research
   automation dependency on live execution.
