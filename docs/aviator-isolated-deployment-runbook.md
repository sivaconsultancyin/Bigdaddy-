# Aviator isolated backend deployment runbook

Target project: `Bigdaddy aviator` (`yrleubhpiqejfvingqfj`)
Shared wallet/auth project: `Bigdaddy` (`nzvpuoeibqrpcltrszvr`)

## Current deployment state

The following Edge Functions are deployed and report ACTIVE:

- `aviator-api`
- `aviator-wallet-worker`
- `aviator-round-engine`
- `aviator-settlement-worker`

They are **not ready for traffic** until secrets are configured and controlled staging tests pass. They fail closed when required secrets are absent. Do not enable production traffic or merge the Draft PR just because deployment status is ACTIVE.

## Configure secrets in the target project's Supabase Dashboard

Open **Project Settings / Edge Functions / Secrets** for `yrleubhpiqejfvingqfj`. Add secrets directly in the dashboard or via the Supabase CLI from a trusted machine. Never commit values, paste them into GitHub issues/PRs, or share them in chat.

Required values:

| Secret name | Required for | Value source |
| --- | --- | --- |
| `BIGDADDY_SHARED_SUPABASE_URL` | API, wallet worker, settlement worker | `https://nzvpuoeibqrpcltrszvr.supabase.co` |
| `BIGDADDY_SHARED_SERVICE_ROLE_KEY` | API, wallet worker, settlement worker | Server-only service-role/secret key from the **shared BigDaddy** project |
| `BIGDADDY_JWT_SECRET` | API | The exact HS256 signing secret used by the existing BigDaddy custom login JWT issuer; do not rotate it as part of this deployment |
| `AVIATOR_WORKER_SECRET` | wallet worker | Generate a unique random secret (at least 32 random bytes) |
| `AVIATOR_ENGINE_SECRET` | round engine | Generate a separate unique random secret (at least 32 random bytes) |
| `AVIATOR_SETTLEMENT_WORKER_SECRET` | settlement worker | Generate a separate unique random secret (at least 32 random bytes) |
| `BIGDADDY_ALLOWED_ORIGINS` | API (recommended) | Comma-separated exact trusted web origins; native clients use the explicit native origins in code |

The target project's `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided by Supabase in the function runtime. Never use a target-project key as the shared project's key or vice versa.

## Scheduler requirements (do not enable until secrets are saved)

Use the target database's `pg_cron` + `pg_net` and Vault, or a trusted external scheduler. Store each worker secret in Vault for scheduler headers; do not hardcode it in SQL, migrations, or source control.

Suggested starting cadence after staging approval:

- `aviator-round-engine`: every 1 second if the project's cron/runtime supports it; otherwise use the shortest supported interval and verify multiplier smoothness and crash timing.
- `aviator-wallet-worker`: every 2 seconds, batch size 20.
- `aviator-settlement-worker`: every 2 seconds, batch size 20.

Every POST must send `Content-Type: application/json` and the matching secret header:

- round engine: `x-aviator-engine-secret`
- wallet worker: `x-aviator-worker-secret`
- settlement worker: `x-aviator-settlement-secret`

The scheduled HTTP requests must target the isolated project's URLs:

- `https://yrleubhpiqejfvingqfj.supabase.co/functions/v1/aviator-round-engine`
- `https://yrleubhpiqejfvingqfj.supabase.co/functions/v1/aviator-wallet-worker`
- `https://yrleubhpiqejfvingqfj.supabase.co/functions/v1/aviator-settlement-worker`

Keep schedule creation disabled until secrets are saved and the smoke tests below pass. Configure monitoring for non-2xx responses, stale leases, repeated retries, and `RECONCILIATION_REQUIRED` results.

## Staging smoke-test gate

1. Confirm API rejects missing/invalid JWTs and returns a controlled 503 until configuration is complete.
2. Confirm engine rejects missing/wrong secret headers and a valid secret advances exactly one tick.
3. Test a funded bet only with a staging test account; verify the source wallet debit and target outbox completion agree.
4. Test cashout/crash race, payout settlement, crash-loss settlement, duplicate retries, timeout after source transaction, and worker restart recovery.
5. Verify revealed crash seed against stored hash and deterministic crash-point test vectors.
6. Reconcile source wallet transactions, reserved liability, target bets, and settlement intents.
7. Verify all staging test operations are settled and balances reconciled before considering production routing.

## Current safety status

At last verification, target counts were 0 rounds, 0 bets, 0 settlements, and 0 wallet operations. No wallet transaction was made. No scheduler has been created. Production traffic remains on the existing backend.
