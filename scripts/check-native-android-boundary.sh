#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_FILE="$ROOT/androidApp/src/main/java/com/bigdaddy/player/data/BigDaddyApi.kt"
SCREENS_DIR="$ROOT/androidApp/src/main/java/com/bigdaddy/player"

test -f "$API_FILE"

# The native APK may call only the authenticated account/session and read-only wallet APIs.
for endpoint in '/auth/login' '/auth/me' '/wallet/my-wallet'; do
  if ! grep -Fq "$endpoint" "$API_FILE"; then
    echo "Missing allowed native API endpoint: $endpoint" >&2
    exit 1
  fi
done

if grep -Ein '(/games/|/rounds|/bets|aviator-engine|realtime|service_role|SUPABASE_SERVICE_ROLE_KEY|JWT_SECRET)' "$API_FILE"; then
  echo "Forbidden server game, Realtime, or privileged-secret reference found in native API adapter." >&2
  exit 1
fi

if grep -RInE '(BigDaddyApi|walletBalance|/auth/me|/wallet/my-wallet|/functions/v1)' "$SCREENS_DIR"/Native*Screen.kt; then
  echo "A native game screen must not call Supabase or the account API directly." >&2
  exit 1
fi

if grep -RInE '(SUPABASE_SERVICE_ROLE_KEY|service_role|JWT_SECRET|SUPABASE_JWT_SECRET)' "$ROOT/androidApp/src/main"; then
  echo "Privileged Supabase or JWT secret reference found in Android main source." >&2
  exit 1
fi

echo "Native boundary OK: games are APK-local; Supabase access is limited to auth/session and read-only wallet."
