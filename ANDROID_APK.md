# Frontend-only Android APK

This project packages the existing React/Vite frontend into an Android APK with Capacitor.
The API/backend remains remote and is not bundled into the APK. Production frontend builds
use the Supabase Edge Functions API URL already configured in `frontend/src/api/client.ts`.

## Build APK

1. Push this branch to GitHub.
2. Open **Actions → Build Android APK → Run workflow** (or wait for a push-triggered build).
3. Open the successful workflow run and download the `bigdaddy-frontend-debug-apk` artifact.
4. Extract the artifact ZIP to get `app-debug.apk`.

The workflow builds a debug APK for testing. A release APK/AAB needs a signing key configured
as GitHub Actions secrets. Never add a Supabase `service_role` key or signing credentials to
source control or the APK.
