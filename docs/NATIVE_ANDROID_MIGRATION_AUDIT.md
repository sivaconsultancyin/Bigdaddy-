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


## Player-account authorization hardening (2026-11-14)

- Native Android session verification now rejects accounts whose server-verified role is not `PLAYER`.
- The same verification path is used after password login and when restoring a saved session, so an OWNER / SUPER_ADMIN / ADMIN token cannot unlock the player game UI through this client.
- Account ID and username are also required to be present in the verified `/auth/me` response.
- This is a client-side access boundary for the Player APK, not a replacement for backend authorization. Every wallet/game mutation must still enforce role and ownership server-side.
- No production Supabase data, wallet balances, or auth configuration were modified.


## Native Aviator server-state integration (2026-11-14)

- Added a typed native API adapter for authenticated GET `/games/aviator/state`. It parses the current server round ID, round number, status, multiplier, and final crash multiplier without generating a client-side outcome.
- Replaced the Aviator demo crash-result screen in the native Player app with a read-only live round status screen. It refreshes sequentially at a one-second interval while the Aviator screen is visible; Compose cancels the polling coroutine when leaving the screen.
- The screen explicitly states that native betting, cashout, and wallet settlement are not enabled. It cannot create a payout or modify wallet balances.
- This is an integration/display milestone, not a native Aviator engine cutover: the existing Supabase Aviator worker remains authoritative for round state. Bet placement/cashout remain unavailable from this native UI until a complete tested client contract and physical-device E2E are delivered.
- No production database, game rounds, player records, wallet balances, or Supabase function deployments were changed by this work.
- CI for this commit must be checked before treating the changes as verified.


## APK-only game execution architecture update (2026-11-14)

- Removed the native Android client's authenticated GET `/games/aviator/state` method and typed server-round model.
- Removed the one-second Aviator server polling loop from the Player app.
- Added a native Compose Aviator demo flight screen. The local engine creates the round, advances the multiplier from a monotonic clock, detects the local demo crash, and records the completed round in Room history.
- The native game UI no longer needs a server game-state request to render or advance the Aviator demo. The API adapter is limited to account/session verification and wallet-balance reads at this stage.
- Other five games still use local deterministic demo outcome entry points; they are not yet full-featured interactive game screens. Exact legacy-rule parity and game-specific controls remain open work.
- The Aviator demo result is device-generated and untrusted. It must never be accepted as proof for a wallet debit/credit. No betting, cashout, deposit, withdrawal, or payout mutation is enabled.
- No production Supabase game tables, Edge Functions, cron jobs, Realtime subscriptions, player records, or wallet balances were changed or disabled.
- CI for commits `d313d727af943233e18594d7127735abf79f83f0`, `75c90950b77f6f075d3e0d83f94064168318d872`, and `24630c965f64c48422d90f33b75dbfde9b56181e` must complete successfully before treating this checkpoint as build-verified.


## Native game-screen implementation checkpoint — 2026-11-14

- Added and wired an interactive local Dragon Tiger round screen: 12-second betting countdown, shuffled two-card deal using Android SecureRandom, reveal/result phases, Ace-low comparison through the native DragonTigerEngine, and Room history callback.
- Added and wired an interactive local Lucky 10 screen: 14-second betting countdown, rolling animation phase, local 1..10 result generated from a SecureRandom seed, market preview for exact number / small / big / even / odd, and Room history callback.
- Both screens are explicitly virtual-demo only. The market preview is informational and does not accept stakes, debit a wallet, or issue payouts.
- Latest source commits for this checkpoint: `089962d` (Dragon Tiger screen), `7ac8f8e` (Dragon Tiger app integration), `6354c5f` (deck construction cleanup), `a27a9b1` (Lucky 10 screen), `fd32260` (Lucky 10 app integration).
- CI for the final integration commit must pass before this checkpoint is considered build-verified. The earlier CI runs passing on commit `6354c5f` do not validate the later Lucky 10 screen/integration commits.
- Remaining: full legacy rule/fixture parity, accessibility and responsive UI QA, lifecycle interruption/recovery, complete Andar Bahar / Roulette / Teen Patti screens, production-quality Aviator screen, device E2E, signed release and staged cutover.


- Follow-up correctness fix: both new game screens now persist Unix epoch-millisecond timestamps (rather than device-uptime values) into Room history. Lucky 10 market buttons are grouped four per row to reduce narrow-screen overflow risk.
- Follow-up commits: `387a0b3`, `a2eb41f`. The final branch head after these changes requires a fresh successful Android CI run; earlier passing runs do not cover it.


## Native Andar Bahar screen checkpoint — 2026-11-14

- Added an interactive local Andar Bahar Compose screen with a 13-second betting countdown, secure shuffled 52-card deck, Joker reveal, alternating card-by-card dealing at the legacy 650 ms cadence, and stop on the first rank match.
- Preserves the legacy opening-side rule: black Joker (Spades/Clubs) starts Andar; red Joker (Hearts/Diamonds) starts Bahar. The winning side is the side assigned to the first matching-rank card.
- Wired the screen into the Games navigation and Room local history. No wager, server round, Supabase game API, wallet debit, or payout is used.
- Corrected the two prior screen timestamp expressions to use Unix epoch milliseconds for Room history; the previous CI logs showed unresolved `SystemClock` references in both screens.
- This remains virtual local gameplay, not production betting or a trusted wallet settlement engine. Android CI and full legacy fixture parity must pass before this checkpoint is considered verified.


## Native European Roulette screen checkpoint — 2026-11-14

- Added a local Compose roulette screen with 14-second betting countdown, a 9.5-second approximate visual spin, and a SecureRandom-seeded 0–36 final result from the native RouletteEngine.
- Added selectable outside-market previews for red/black, even/odd, low/high, dozens and columns, using the single-zero European wheel semantics and zero exclusions.
- Wired the screen into Games and Room history. This remains virtual-only; no bet placement, wallet mutation, or server game round is used.
- Rule fixtures for zero, wheel colors, outside bets and invalid numbers are covered by native engine unit tests. Full Android CI and device UX verification remain pending.
