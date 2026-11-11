# Andar Bahar release verification

## Activation gate

This checklist is versioned with the release PR; rerun the complete CI suite on every update to the lifecycle, wallet or API implementation.
Do not change `platform.games.status` from `COMING_SOON` until all required CI jobs pass, the migration is applied, the Edge API is deployed, and the production smoke tests below pass.

## Required automated coverage
- Lint, TypeScript checks and frontend production build
- 10,000 deterministic Andar Bahar rounds with card-match, Joker-color first-side and alternating-deal invariants
- Verify both Joker colors produce the matching first side and invert first/second-side gross payout correctly
- Joker-color-driven first side: black Joker starts Andar; red Joker starts Bahar
- First-dealt side 1.90x, second-dealt side 2.00x, Joker Red/Black 1.95x
- Progressive card reveal while the winner remains hidden until settlement
- Sanitized Realtime broadcast on `andar_bahar:rounds` plus authenticated state-poll fallback
- Synthetic wallet debit, escrow, gross payout, pool balance and duplicate-settlement checks
- Isolated PostgreSQL round creation, seed commitment, card dealing, bet settlement, pool reservation release, duplicate-call idempotency and invalid-selection rejection
- Edge API typecheck and existing platform financial/security suites

## Production verification
1. Apply the migration from `supabase/migrations/20261111120000_andar_bahar_authoritative_round_lifecycle.sql`.
2. Deploy the `api` Edge Function from the matching GitHub source.
3. Verify pool mapping and available liability (at least 2x max bet).
4. Activate only through the guarded activation API; it must create the first persisted BETTING round.
5. Verify the authenticated state API, card reveal, history, betting, settlement and wallet ledger using an isolated test user/wallet inside a rolled-back transaction.
6. Verify mobile/Android layout and reconnect recovery.
7. Confirm the production game is ACTIVE and rounds continue to advance while the client polls.

## Financial safety
- Never use a real customer's wallet for testing.
- Never edit balances directly outside a transactionally rolled-back isolated test.
- Never expose the server seed or winning side before settlement.
- Any smoke-test failure must leave the game `COMING_SOON`.
