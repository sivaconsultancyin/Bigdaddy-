# BigDaddy Casino — System Architecture

## 1. High-Level Architecture

BigDaddy Casino is built with a strictly decoupled monorepo architecture:

```
├── /frontend      # Mobile-first React + Vite + Tailwind CSS iGaming Client
├── /backend       # Node.js + Express + WebSocket Authoritative Game Server
├── /database      # Relational PostgreSQL / Supabase Schemas, Constraints & Seed
├── /shared        # Shared TypeScript Types, Zod Schemas & Invariant Constants
├── /docs          # Architectural & Security Blueprint Documentation
└── /test          # Comprehensive Automated Test Suite
```

## 2. Fixed Token Supply Invariant (10,000,000,000)

The total circulating token volume across all entities is strictly locked to **10 Billion tokens**:

$$\sum \text{Balance}(\text{Treasury}) + \sum \text{Balance}(\text{Roles}) + \sum \text{Balance}(\text{GamePools}) + \text{Balance}(\text{Escrow}) = 10,000,000,000$$

### Key Accounting Tenets:
1. **Single Genesis Mint**: Tokens are initialized once into the Owner Treasury.
2. **Zero In-Flight Minting**: Moving tokens between accounts debits and credits atomically.
3. **Double-Entry Ledger**: Every ledger entry has matching debit and credit rows with cryptographic timestamping.
4. **No Direct User Mutation**: Frontend clients never manipulate balances; all mutations occur inside backend database transactions.

## 3. Four-Tier Hierarchy & Role Boundaries

```
[OWNER] 
   └── [SUPER_ADMIN]
          └── [ADMIN]
                 └── [PLAYER]
```

- **OWNER**: Controls Owner Treasury, allocates liquidity to dedicated Game Pools, approves Super Admin token requests, configures games, reviews master audit logs.
- **SUPER_ADMIN**: Manages Admins in their own tree, approves Admin token requests, transfers tokens downward. Isolated from other Super Admins.
- **ADMIN**: Manages Players in their tree, creates Players, approves Player token requests, transfers tokens downward. Isolated from other Admins.
- **PLAYER**: Casino participant. Can play active games (Aviator), cash out, view own transactions, request tokens from Admin, and invite other players via active Referral Code.

## 4. Game Settlement Engine & Pool Isolation

Winnings are paid exclusively from **dedicated Game Pools**, never from the Owner Treasury:
- **Bet Placed**: Player balance debited $\to$ Bet Escrow credited. Game Pool verified for maximum liability solvency.
- **Player Cashout (Win)**: Stake refunded from Bet Escrow $\to$ Player. Net profit debited from Game Pool $\to$ Player.
- **Plane Crash (Loss)**: Unsettled bet stakes in Bet Escrow transferred directly to Owner Treasury. Game Pool is untouched.
