#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_FILE="$ROOT/androidApp/src/main/java/com/bigdaddy/player/data/BigDaddyApi.kt"
APP_FILE="$ROOT/androidApp/src/main/java/com/bigdaddy/player/BigDaddyApp.kt"
AVIATOR_FILE="$ROOT/androidApp/src/main/java/com/bigdaddy/player/NativeAviatorScreen.kt"
BUILD_FILE="$ROOT/androidApp/build.gradle.kts"

test -f "$API_FILE"
test -f "$APP_FILE"
test -f "$AVIATOR_FILE"
test -f "$BUILD_FILE"

# Supabase remains the existing auth/session/read-only wallet service.
for endpoint in '/auth/login' '/auth/me' '/wallet/my-wallet'; do
  if ! grep -Fq "$endpoint" "$API_FILE"; then
    echo "Missing allowed native account API endpoint: $endpoint" >&2
    exit 1
  fi
done

# Game state is read from the configured Node.js backend, never from a local APK engine.
if ! grep -Fq 'BIGDADDY_BACKEND_URL' "$BUILD_FILE"; then
  echo "Missing configurable Node.js backend URL in Android BuildConfig." >&2
  exit 1
fi
if ! grep -Fq 'backendRequest("/games/aviator/state"' "$API_FILE"; then
  echo "Native Aviator state must use the Node.js backend API." >&2
  exit 1
fi
if ! grep -Fq 'api.aviatorState(token)' "$AVIATOR_FILE"; then
  echo "Native Aviator screen must render the authenticated server state." >&2
  exit 1
fi

if grep -Ein '(/games/.*/(bet|cashout|spin|roll|boot|action)|aviator-engine|service_role|SUPABASE_SERVICE_ROLE_KEY|JWT_SECRET)' "$API_FILE"; then
  echo "Unexpected native game mutation or privileged-secret reference found in the API adapter." >&2
  exit 1
fi

if grep -Ein '(AviatorGameEngine|DemoOutcome|createDemoRound|LocalDemoGameRegistry|Random\(|LOCAL DEMO|Start visual demo)' "$AVIATOR_FILE"; then
  echo "Local or fabricated Aviator game execution found in the native screen." >&2
  exit 1
fi

if grep -Ein '(LocalDemoGameRegistry|AviatorGameEngine|NativeDragonTigerScreen|NativeLuckyTenScreen|NativeAndarBaharScreen|NativeRouletteScreen|NativeTeenPattiScreen)' "$APP_FILE"; then
  echo "A local game engine or local game screen is still wired into the native app." >&2
  exit 1
fi

if grep -RInE '(SUPABASE_SERVICE_ROLE_KEY|service_role|JWT_SECRET|SUPABASE_JWT_SECRET)' "$ROOT/androidApp/src/main"; then
  echo "Privileged Supabase or JWT secret reference found in Android main source." >&2
  exit 1
fi

echo "Native boundary OK: game state uses the configured Node.js backend; Supabase is retained for auth/session/wallet; no APK-local game results."
