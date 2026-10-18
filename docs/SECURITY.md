# BigDaddy Casino — Security Specifications & Hardening

## 1. Zero Trust Backend Authority
- Client frontend is strictly a visualization layer.
- Never trust client inputs: all bets, multipliers, transfers, and settlements are executed authoritatively on the backend.
- Floating-point calculations are banned for token accounting. All token math uses safe `BIGINT` integer arithmetic.

## 2. Authentication & Authorization
- Passwords are salted and hashed using `bcrypt` (10 rounds).
- Stateful role validation executed on every endpoint (`requireRole`).
- Cross-branch access control prevents Super Admins and Admins from viewing or interacting with other branches.

## 3. Financial Invariant Enforcement
- Max supply is constrained to exactly 10,000,000,000 tokens.
- Balance check invariants prevent negative balances ($balance \ge 0$).
- Idempotency keys prevent duplicate credit or debit execution during network retries.

## 4. Game Pool Solvency Protection
- The engine checks Game Pool balances against prospective liabilities before locking bets.
- If a pool cannot support potential payouts, new bets are safely rejected.
- Player losses fund the Owner Treasury, keeping Game Pools clean of non-house winnings.

## 5. Audit Trail & Immutability
- Double-entry ledger records cannot be edited or deleted.
- All privileged actions (user creation, approvals, allocations) are logged in the `audit_logs` table with actor metadata and timestamps.
