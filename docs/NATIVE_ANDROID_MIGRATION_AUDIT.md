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
