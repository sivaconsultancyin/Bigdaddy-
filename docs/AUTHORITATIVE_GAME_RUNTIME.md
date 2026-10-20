# Authoritative game runtime

This change moves Roulette, Dice, Dragon Tiger, and Andar Bahar round results and settlements to the trusted Node backend with durable state in Supabase PostgreSQL. Aviator/Crash continues to use the existing `game_rounds`/`game_bets` flow and receives a recovery fix for rounds left `CRASHED` before settlement.

## Runtime flow

1. The backend game supervisor starts only after the PostgreSQL connection and production configuration succeed.
2. It creates rounds only for games whose `public.games.status` is `ACTIVE`. New catalog rows start as `COMING_SOON`.
3. Bets require a valid backend JWT, an open Supabase-backed round, a unique idempotency key, and an enabled game with a funded pool wallet.
4. Bet stake is transferred from the player wallet to the escrow wallet through `wallet_transfer_atomic`.
5. Maximum gross payout liability is reserved against the game's pool wallet. The server rejects bets if unreserved pool balance is insufficient.
6. At the deadline, the server generates the result from the private round seed, stores it in PostgreSQL, then settles each pending bet in a transaction. The stake moves from escrow to the game pool; winning gross payout moves from pool to player.
7. Round results and the seed reveal are exposed only after the persisted result phase/settlement. On process restart, expired `BETTING` rounds are resolved and `RESULT` rounds are retried until settlement succeeds.
8. The production frontend polls the backend state endpoints. It must not create authoritative outcomes or add locally generated history entries.

## Game codes and pool setup

Canonical Supabase codes are `roulette`, `dice`, `dragon_tiger`, and `andar_bahar`. The migration provisions a zero-balance GAME_POOL wallet and a `COMING_SOON` game row for each missing game. It does not mint tokens or activate games.

To enable a game after the migration has been tested in staging:
- As Owner, allocate existing Treasury tokens to that game's pool through the game pool allocation UI.
- The API activates that game only after the Treasury transfer succeeds and the pool balance is positive.
- Confirm the pool is isolated to one game and that its `reserved_balance` covers the sum of pending bet liabilities.
- Verify state, bet placement, settlement, wallet ledger, and restart recovery before enabling players.

Do not manually set a game to ACTIVE with a zero-balance or shared pool.

## Server-owned rules

- **Roulette:** European wheel 0–36. Straight 36x gross; split 18x; street 12x; corner 9x; six-line 6x; dozen/column 3x; red/black/odd/even/low/high 2x; green 36x. The zero pocket loses even-money and outside bets.
- **Dice:** server result 1–10. Exact number 10x gross; odd/even/small/big/over/under 2x gross.
- **Dragon Tiger:** cards are server-dealt from a deterministic shuffled multi-deck shoe. Dragon/Tiger 2x gross; tie 9x gross; suited tie 51x gross; big/small side bets 2x gross. Ace is represented as rank 14 and compared low.
- **Andar Bahar:** one server-shuffled deck; a joker is selected and cards alternate Bahar/Andar until its rank matches. Winning side pays 2x gross.

These multipliers are backend policy, not frontend instructions. Before production activation, product owners should confirm the displayed rules and local regulatory requirements.

## Verification checklist

- Run `npm test` and `npm run lint` in CI.
- Apply the migration only to a disposable/staging database first.
- Run `scripts/authoritative_game_runtime_audit.sql` after migration and after settlement tests.
- Test two simultaneous bets against the same round, duplicate idempotency replay, insufficient pool liquidity, expired betting round recovery, settlement retry after process restart, and wallet-ledger conservation.
- Verify the live production backup and restore path before applying to production. This PR does not apply any migration to the connected live Supabase project.
