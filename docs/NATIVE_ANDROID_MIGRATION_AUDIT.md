# Native Android Migration — Initial Audit (2026-11-14)

## Baseline
- Repository: sivaconsultancyin/Bigdaddy-
- Main commit: 5f136fb78bf870de9fefe8f09a6e442aefe781c1
- Branch: feat/native-android-architecture-migration
- Supabase project: nzvpuoeibqrpcltrszvr (ACTIVE_HEALTHY, PostgreSQL 17)

## Verified architecture gap
The current root is a React 19 / TypeScript / Vite application. The recursive main-branch tree has no Kotlin/Java sources, AndroidManifest.xml, Gradle build files or Gradle wrapper. There is therefore no existing native Android app module to migrate incrementally; the native application foundation must be added alongside the current web application.

## Discovered games
- Aviator
- Dragon Tiger
- Dice / Lucky 10
- Andar Bahar
- Roulette
- Teen Patti

The repository has frontend game screens and backend engines/routes. The Supabase production project also contains authoritative game schemas and functions. These implementations must be treated as legacy dependencies until the APK cutover is verified.

## Supabase production inventory
- Schemas observed: platform, wallet, aviator, dragon_tiger, dice, andar_bahar, roulette (plus Supabase-managed schemas).
- Wallet tables include wallets, wallet_transactions, ledger_entries and token_supply.
- Aviator tables include game_rounds, game_bets, game_settlements and engine_worker_lease.
- Active Edge Functions observed: health, auth-login, auth-me, api, wallet-my-wallet, aviator-engine.
- Cron inspection: Aviator and Dragon Tiger jobs were inactive at inspection time.
- Production migration ledger has 60+ records through 2026-11-13.
- Security Advisor INFO: aviator.engine_worker_lease has RLS enabled and no policies. Confirm service-only access and grants before changing.
- Performance Advisor: 32 unused-index notices. Do not drop indexes without workload evidence.

## Critical design constraints
1. The user requests local-only demo game rounds/results/animations/history. Local demo results are untrusted and must never authorize wallet credits.
2. Existing login appears to use a custom BigDaddy bearer token issued through Supabase Edge Functions; do not assume Supabase Auth sessions are already used. Map current identity/password/session storage before changing auth.
3. Existing wallet operations are coupled to authoritative game bets and settlement. Define the permitted virtual-token model before retiring these RPCs.
4. Do not disable or delete production game functions, tables, cron, Realtime, or migration history until a staged native cutover and rollback are proven.
5. Never put service-role keys in the APK.

## Initial issue register
| ID | Severity | Area | Finding | Required verification |
|---|---|---|---|---|
| AND-001 | P0 | Android build | No native Android module, Gradle wrapper or Kotlin source exists on main | Android CI build + installable APK |
| AND-002 | P1 | Game architecture | Game lifecycle is split among React, backend engines and Supabase authoritative functions | Static call-graph proves native local demo engines have no Supabase game calls |
| AND-003 | P1 | Authentication | Existing API uses custom BigDaddy bearer-token flow; Supabase Auth compatibility is unverified | Login/session/expiry/revocation contract tests |
| AND-004 | P1 | Wallet | Current wallet operations are coupled to game bet/settlement RPCs | Atomic/idempotent virtual-token tests; no client-generated payout credits |
| AND-005 | P1 | Cutover | Active Edge Functions and legacy DB game schemas still exist | Dependency inventory, staged rollout and rollback drill |
| AND-006 | P2 | Database security | RLS advisor reports no policy on aviator.engine_worker_lease | Verify grants, schema exposure and service-only access |
| AND-007 | P2 | Database performance | 32 unused-index notices | Compare production workload and constraints before any index change |
| AND-008 | P2 | Scheduler | Aviator and Dragon Tiger cron jobs were inactive during inspection | Verify current intended runtime and avoid accidental round activation |

## Next implementation phases
- Native Gradle/Compose foundation and Android CI.
- Shared app core: auth gateway, wallet gateway, navigation, Room history and DataStore preferences.
- Local demo engines and deterministic tests for each discovered game.
- API contract tests and strict wallet boundary.
- Supabase caller/cron/function inventory, then reversible cleanup only after native release verification.


## Native foundation implementation update (2026-11-14)

The separate Kotlin/Compose module now contains:
- Encrypted BigDaddy bearer-token storage backed by Android Keystore + DataStore.
- Login and session verification through the existing `/functions/v1/api/auth/login` and `/auth/me` routes, followed by a fresh `/wallet/my-wallet` read. The app does not expose or persist the token until session verification and wallet retrieval succeed.
- Client-safe Supabase project URL and publishable key defaults, with Gradle property/environment overrides. No service-role key or JWT signing secret is packaged in the APK.
- Room-backed local game history and six local demo game entry points.
- Aviator local demo animation and multiplier using one monotonic time source.
- Basic deterministic engine tests; Dragon Tiger treats Ace as the lowest card (matching the inspected legacy backend rule), Andar Bahar starts Andar for a black Joker and Bahar for a red Joker, and Teen Patti compares hand category and tie-break values.

## Release blockers — do not treat the preview APK as production

- The six local game engines are still demo implementations and have not been reconciled against every legacy game rule, payout table, tie rule, and edge case.
- Wallet balance is read-only in the native app. A client-generated local result is untrusted and must not directly debit or credit the Supabase wallet. Any real virtual-token wager/settlement needs a server-authoritative validation and idempotent ledger contract, or must remain local-only and clearly marked as demo.
- Native screens are a foundation, not a complete port of all existing player/admin flows.
- No physical Android device E2E, accessibility/responsive QA, signed release build, Play distribution, or rollback/cutover verification has been completed.
- Keep the existing web app, production game schemas, Edge Functions, scheduled jobs, wallet balances, and player records intact until the native release passes the staged acceptance plan.


## Latest implementation and CI checkpoint (2026-11-14)

- Player navigation was simplified so the main bottom navigation contains Games only; Profile is opened from the top-right action. Local game history is displayed within Profile. This removes the direct Wallet and History navigation tabs from the main game screen.
- The latest verified Android CI run before this UI commit was run `43588998743` on commit `6caca28922f801c8daa2fef3eb290c8927b0dabd`: `assembleDebug` succeeded, `testDebugUnitTest` succeeded, and `bigdaddy-native-debug-apk` was uploaded (12,678,189 bytes). This verification does not cover the subsequent UI commits; CI must pass again on the latest head.
- Deposit and Withdraw are not wired in the native UI because the inspected native API adapter exposes login/session and read-only wallet balance only. Do not add fake/inert transaction buttons. Implement these only after a secure, server-authoritative deposit/withdraw API contract, validation, idempotency, and audit trail are verified.
- The current build remains a local-demo foundation. No real wager, client-side payout, or local game result may change the authoritative Supabase wallet.


## Engine edge-case hardening update (2026-11-14)

- Tightened the native Lucky 10 payout helper to reject results outside the only legal result domain (1..10) before checking parity or range markets. This prevents invalid values such as 12 from being treated as an even win.
- Added deterministic tests for Lucky 10 invalid-result boundaries, European Roulette zero behavior across outside markets, and invalid wheel numbers.
- These are local engine-helper tests only. They do not enable wagering, create wallet transactions, or replace the legacy server's cryptographic outcome generation.


## Latest CI verification — current PR head (2026-11-14)

Verified against commit `b1fda17687156ffe16b9c5875a151a03bc634ed5` on PR #215:

- Native Android CI run [43590073975](https://github.com/sivaconsultancyin/Bigdaddy-/actions/runs/43590073975): passed. `assembleDebug`, `testDebugUnitTest`, and debug APK artifact upload all completed successfully.
- BigDaddy Casino CI run [43590074059](https://github.com/sivaconsultancyin/Bigdaddy-/actions/runs/43590074059): passed. Aviator recovery/Realtime fixtures, monotonic multiplier sequence, bounded tick retry, single-worker lease/heartbeat, Edge Function type-checks, schema cutover/migration fixtures, wallet idempotency/concurrency/rollback tests, frontend lint/type-check/build and financial/authorization tests all completed successfully.
- Native debug APK artifact: `bigdaddy-native-debug-apk`, 12,680,182 bytes, SHA-256 `8d590e04b83fb8741527ba48022f903b13fa8a7c306eab00962b9bc4c75fc12f`. Artifact is available from the Android Actions run and is not a signed production release.

CI success verifies repository automation and isolated fixtures only. It does not prove physical-device E2E, production Supabase migration, complete native game parity, real-money/virtual-wallet settlement, signed release, or staged cutover. PR #215 remains Draft and must not be merged as a production migration until those gates are completed. No production Supabase data or wallet balances were changed by this CI verification.
