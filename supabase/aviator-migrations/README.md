# Isolated Aviator migrations

This directory is for SQL changes that target the separate \`Bigdaddy aviator\` Supabase project (\`yrleubhpiqejfvingqfj\`). It is intentionally separate from \`supabase/migrations/\`, whose configured project is the shared BigDaddy project.

Do not run \`supabase db push\` from the repository root for files in this directory. The isolated project's existing seven migration sources are not yet reconstructed here, so a CLI migration-history reconciliation is still required before automating deploys.

The migration in this directory is source-controlled and covered by the disposable PostgreSQL CI fixture. It is **not applied to the live project by CI**. Before a live apply, review the isolated project's migration ledger and use the approved deployment process with the explicit isolated project ref and backup/rollback plan.
