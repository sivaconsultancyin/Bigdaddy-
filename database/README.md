# BigDaddy Casino — Database Architecture & Specifications

## Overview
BigDaddy Casino uses a strict relational database architecture designed for high-concurrency iGaming operations, total financial auditability, and mathematical invariance.

### Core Mathematical Invariant:
$$\sum \text{Wallet Balances} = \text{Max Token Supply} = 10,000,000,000 \text{ tokens}$$

No new tokens can ever be created or destroyed after genesis initialization.

## Tables Summary

1. `users`: Master account credentials with bcrypt hash and hierarchy link (`parent_id`).
2. `user_profiles`: Display name, avatar, and player preferences.
3. `role_assignments`: Fixed roles (`OWNER`, `SUPER_ADMIN`, `ADMIN`, `PLAYER`).
4. `referral_codes`: Player referral codes tying referred players to their sponsor and responsible Admin.
5. `token_supply`: Single-row integrity keeper locking max tokens to exactly 10 Billion.
6. `wallets`: Holds `balance` and `reserved_balance` as `BIGINT`. Includes Treasury, Escrow, Game Pools, and User Wallets.
7. `token_requests`: Multi-tier approval requests (`PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`).
8. `wallet_transactions`: Unique financial actions with idempotency keys.
9. `ledger_entries`: Double-entry accounting records (`DEBIT` and `CREDIT`) for each transfer.
10. `games`: Registered casino game engines and betting boundaries.
11. `game_pools`: Dedicated liquidity reserve for each game.
12. `game_rounds`: Authoritative game iterations with provably fair server seeds.
13. `game_bets`: Player stakes placed in escrow.
14. `game_settlements`: Authoritative win/loss calculations executed atomically.
15. `audit_logs`: Immutable trail of administrative and security events.
16. `user_sessions`: JWT refresh tokens with hardware footprint.

## Settlement Logic

### 1. Placing a Bet
- `amount` deducted from Player's `balance` and moved into `reserved_balance` (or Escrow wallet).
- Game Pool solvency checked: $\text{GamePool.balance} \ge \text{Maximum Potential Win}$.

### 2. Settling a Win
- Original stake returned to Player from Escrow.
- Net profit debited from `GAME_POOL` and credited to Player.
- Double-entry ledger entries recorded.

### 3. Settling a Loss
- Escrow stake debited and credited directly to `TREASURY`.
- Game pool remains untouched on losses.
