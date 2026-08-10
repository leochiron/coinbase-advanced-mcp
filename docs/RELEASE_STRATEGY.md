# Release and Rollback Strategy

## Version lines

- `v1.x` is the historical TypeScript Coinbase MCP line. Published MIT-tagged
  revisions keep their original license permanently.
- `v2.x` is the hybrid TypeScript + Python line under the license in the current
  tree. It preserves the v1 runtime and adds default-off research automation.

The v2 branch is based directly on the latest `origin/main`, so its Git history
continues the original TypeScript repository rather than replacing it.

## Merge process

1. Push a dedicated v2 feature branch.
2. Open a draft pull request against `main`.
3. Attach the validation evidence listed in `COMPATIBILITY_MATRIX.md`.
4. Exercise `OBSERVE`, then `PAPER`; v2 has no live automation mode.
5. Merge only after review of migrations, safety locks and artifacts.
6. Create a v2 tag only from a clean, validated merge commit.

## Rollback

Runtime state is additive and local. The v2 SQLite migrations do not remove v1
tables or columns. To roll back the application:

1. stop `research:daemon`;
2. set `RESEARCH_AUTOMATION_MODE=OFF`;
3. preserve a copy of `data/audit.sqlite` and ignored runtime state;
4. run a known v1 tag or the pre-v2 commit;
5. point the MCP client back to that build.

Older code ignores the additive v2 tables. Never use `git reset --hard` as an
operational rollback and never publish the local audit database.
