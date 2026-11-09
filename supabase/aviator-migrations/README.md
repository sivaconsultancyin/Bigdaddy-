# Isolated Aviator migrations

Target project: \`Bigdaddy aviator\` (\`yrleubhpiqejfvingqfj\`).

## Current source layout

- Eleven isolated-Aviator migration files are still stored in the root \`supabase/migrations/\` directory alongside shared-project SQL.
- The isolated project has seven applied ledger entries. Seven repository files match those entries by migration name but have different version prefixes; four additional isolated files are not present in the isolated applied ledger.
- This directory currently contains the new isolated security migration \`20261110100000_harden_aviator_grants_and_fk_indexes.sql\`.
- The root \`supabase/config.toml\` points to the shared BigDaddy project, not this isolated project.

## Safety

Do not run a blanket \`supabase db push\` from the repository root against either project. The mixed directory can send isolated-project migrations to the shared project. Do not run \`supabase db push\` from this directory either: the seven historical isolated migration sources have not yet been reconstructed here.

Before deployment:
1. Confirm the existing isolated-project deployment workflow.
2. Reconcile all seven applied ledger entries with the eleven repository files by SQL effect, not name alone.
3. Decide and review the final per-project directory/config layout.
4. Run clean-bootstrap and upgrade tests against disposable PostgreSQL.
5. Obtain explicit approval and a backup/rollback plan before applying any live DDL.

The migration in this directory is source-controlled and covered by disposable PostgreSQL CI. It is **not applied to the live project by CI**.
