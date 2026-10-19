# BigDaddy Casino — Authoritative REST & WebSocket API

## Authentication & Identity

### `POST /api/auth/login`
Authenticates a user against bcrypt password hash.
- **Request Body**: `{ "username": "string", "password": "string" }`
- **Response**: `{ "token": "jwt", "user": { ... }, "wallet": { ... } }`

### `POST /api/auth/register-referral`
Registers a new Player using an active referral code.
- **Request Body**: `{ "username": "string", "email": "string", "password": "string", "referralCode": "string" }`

### `POST /api/auth/create-user`
Hierarchical user creation (Owner $\to$ SuperAdmin, SuperAdmin $\to$ Admin, Admin $\to$ Player).
- **Headers**: `Authorization: Bearer <jwt>`
- **Request Body**: `{ "username": "string", "email": "string", "password": "string", "role": "string", "initialTokens": "string" }`

### `GET /api/auth/users`
Returns users within the caller's authorized hierarchy branch.

---

## Wallet & Ledger Operations

### `GET /api/wallet/my-wallet`
Returns caller's current wallet and available balances.

### `GET /api/wallet/summary` (Owner Only)
Returns the master 10-Billion supply breakdown and mathematical invariant verification.

### `GET /api/wallet/ledger`
Returns double-entry audit ledger entries.

### `POST /api/wallet/transfer`
Direct token transfer to subordinate in hierarchy.

---

## Token Requests

### `POST /api/requests/create`
Submits token request to superior hierarchy node.

### `GET /api/requests/list`
Lists pending and historical token requests.

### `POST /api/requests/:id/approve`
Approves request and triggers atomic transfer.

### `POST /api/requests/:id/reject`
Rejects request without balance change.

---

## Aviator / Crash Engine

### `GET /api/games/aviator/state`
Returns current flight status, live multiplier, and recent crash history.

### `POST /api/games/aviator/bet` (Player Only)
Locks bet into Escrow and registers player for active round.

### `POST /api/games/aviator/cashout` (Player Only)
Authoritatively settles the bet using the backend multiplier. The payout comes from the Aviator/Crash Game Pool; the held stake is transferred from Escrow back into that pool. The database settlement function releases the reserved maximum-liability amount.

---

## WebSocket API (`/ws`)

Connect to `ws://<host>/ws` for development/preview real-time state. Production WebSocket game streams are disabled:
- `aviator:tick`: `{ multiplier: 1.84, roundId: "..." }`
- `aviator:crashed`: `{ crashMultiplier: 2.45, ... }`
- `aviator:round_waiting`: Next round betting phase initialized
- `aviator:bet_cashed_out`: Live cashout broadcast
