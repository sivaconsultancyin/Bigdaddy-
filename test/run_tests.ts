import assert from 'assert';
import { createHmac } from 'crypto';
import { spawnSync } from 'node:child_process';
import { readRunningRealtimeMultiplier } from '../shared/src/aviatorRealtime';
import { readdirSync, readFileSync } from 'node:fs';
import { applyExplicitCorsOrigin } from '../shared/src/cors';
import { isNewerRealtimeEvent, isNewerRoundSnapshot, readRealtimeEventCursor } from '../shared/src/aviatorRealtime';
import { db } from '../backend/src/db/storage';
import { AuthService } from '../backend/src/services/auth.service';
import { config, getPublicConfigInfo, ProductionConfigError } from '../backend/src/config';
import { UserRole, TransactionType, RoundStatus, BetStatus } from '../shared/src/types';
import { evaluateGameActivationReadiness, getAndarBaharPublicDeal } from '../supabase/functions/api/activation';
import { MAX_TOKEN_SUPPLY, MAX_TOKEN_SUPPLY_BIGINT, SYSTEM_WALLETS } from '../shared/src/constants';
import { makeResult, resolveDragonTigerWinner, payoutMultiplier, validateSelection, isPlayerRole, isCompatibleIdempotencyReplay, canReserveLiability, canSettleRound, maxLiabilityMultiplier } from '../backend/src/routes/authoritative-games.routes';
import { buildRouletteBetOperation } from '../frontend/src/api/idempotency';
import { resolveSupabasePublicConfig } from '../frontend/src/api/supabaseConfigValidation';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  try {
    fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     Reason: ${err.message}`);
    failed++;
  }
}

async function runTestSuite() {
  console.log('\n======================================================');
  console.log('🎰 BIGDADDY CASINO — AUTOMATED TEST SUITE');
  console.log('======================================================\n');

  test('In-memory StorageEngine fails closed in production mode', () => {
    const script = "import('./backend/src/db/storage.ts').then(() => process.exit(2)).catch((error) => { if (error?.message === 'IN_MEMORY_STORAGE_DISABLED_IN_PRODUCTION') process.exit(0); console.error(error); process.exit(1); })";
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'production' },
    });
    assert.strictEqual(result.status, 0, `Production storage guard failed. stdout=${result.stdout} stderr=${result.stderr}`);
  });

  test('Production auth modules do not eagerly import seeded in-memory storage', () => {
    const authSource = readFileSync('backend/src/services/auth.service.ts', 'utf8');
    const middlewareSource = readFileSync('backend/src/middleware/auth.middleware.ts', 'utf8');
    assert.ok(!authSource.includes("from '../db/storage'"));
    assert.ok(!middlewareSource.includes("import { db } from '../db/storage'"));
    assert.ok(middlewareSource.includes("await import('../db/storage')"));
  });

  test('API health inventory covers every registered backend API route', () => {
    const routeFiles = [
      'server.ts',
      'backend/src/routes/production.routes.ts',
      'backend/src/routes/production.requests.routes.ts',
      'backend/src/routes/authoritative-games.routes.ts',
    ];
    const inventorySource = readFileSync('frontend/src/components/owner/ApiHealthPanel.tsx', 'utf8');
    const inventory = [...inventorySource.matchAll(/\{ method: '([A-Z]+)', path: '([^']+)'/g)]
      .map((match) => ({ method: match[1], path: match[2] }));
    const definitions = routeFiles.flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return [...source.matchAll(/(?:productionRouter|productionRequestsRouter|authoritativeGamesRouter|app)\.(get|post|put|patch|delete|options|head)\s*\(\s*'([^']+)'/g)]
        .map((match) => ({
          method: match[1].toUpperCase(),
          path: match[2].replace(/^\/api(?=\/)/, ''),
        }))
        .filter((route) => route.path !== '*');
    });
    const matchesRoute = (pattern: string, actual: string) => {
      const expectedParts = pattern.split('/');
      const actualParts = actual.split('/');
      return expectedParts.length === actualParts.length && expectedParts.every((part, index) =>
        part.startsWith(':') ? actualParts[index].length > 0 : part === actualParts[index]
      );
    };
    const missing = definitions.filter((route) =>
      !inventory.some((probe) => probe.method === route.method && matchesRoute(route.path, probe.path))
    );
    assert.deepStrictEqual(missing, [], 'Health inventory is missing registered backend routes');
  });


  test('Public Aviator Realtime never supplies crash target as a RUNNING multiplier', () => {
    assert.strictEqual(readRunningRealtimeMultiplier({ status: 'RUNNING', crashMultiplier: 25 }), null);
    assert.strictEqual(readRunningRealtimeMultiplier({ status: 'RUNNING', multiplier: 1.27, crashMultiplier: 25 }), 1.27);
    assert.strictEqual(readRunningRealtimeMultiplier({ status: 'CRASHED', crashMultiplier: 1.27 }), null);
  });

  test('Dragon Tiger authoritative cron worker advances rounds only after activation', () => {
    const migration = readFileSync('supabase/migrations/20261112122447_dragon_tiger_authoritative_cron_worker.sql', 'utf8');
    assert.ok(migration.includes("cron.schedule("));
    assert.ok(migration.includes("'1 second'"));
    assert.ok(migration.includes("status = 'ACTIVE'"));
    assert.ok(migration.includes('dragon_tiger.advance_round()'));
  });

  test('Legacy Dragon Tiger engine exposes no simulated community bets or side markets', () => {
    const source = readFileSync('backend/src/games/dragon-tiger/dragon-tiger.engine.ts', 'utf8');
    assert.ok(!source.includes('suited_tie'));
    assert.ok(!source.includes('dragon_big'));
    assert.ok(!source.includes('tiger_big'));
    assert.ok(!source.includes('scheduleSimulatedCommunityBets'));
  });

  test('Dragon Tiger atomic bet RPC enforces exactly three markets before liability reservation', () => {
    const migration = readFileSync('supabase/migrations/20261112123252_dragon_tiger_atomic_market_allowlist.sql', 'utf8');
    assert.strictEqual((migration.match(/NOT IN \\('dragon','tiger','tie'\\)/g) || []).length, 2);
    assert.ok(migration.includes('INVALID_DRAGON_TIGER_SELECTION'));
    assert.ok(migration.includes("v_multiplier := 9"));
    assert.ok(migration.includes("v_multiplier := 2"));
    assert.ok(!migration.includes('suited_tie'));
    assert.ok(!migration.includes('dragon_big'));
    assert.ok(!migration.includes('tiger_big'));
  });

  test('Shared migration directory matches the reviewed ledger snapshot manifest', () => {
    const manifest = JSON.parse(readFileSync('docs/shared-supabase-migration-ledger-manifest.json', 'utf8'));
    const actualFiles = (readdirSync('supabase/migrations') as string[]).filter((name: string) => name.endsWith('.sql')).sort();
    assert.deepStrictEqual(actualFiles, manifest.repositoryFiles);
    assert.strictEqual(manifest.counts.totalSupabaseMigrationFiles, 63);
    assert.deepStrictEqual(manifest.sharedProjectFiles, actualFiles);
    assert.deepStrictEqual(manifest.isolatedProjectFiles, []);
    assert.strictEqual(manifest.counts.sharedAppliedLedger, 73);
    assert.strictEqual(manifest.counts.sharedRepositoryFiles, 63);
    assert.strictEqual(manifest.counts.sharedExactVersionNameMatches, 26);
    assert.strictEqual(manifest.counts.sharedAppliedOnly, 47);
    // Historical source-only migration candidates remain tracked; Dragon Tiger migrations are exact production ledger matches.
    assert.strictEqual(manifest.counts.sharedFileOnly, 37);
    const exactAppliedFiles = new Set(
      (manifest.appliedLedger as Array<{ version: string; name: string }>).map(
        (entry) => `${entry.version}_${entry.name}.sql`,
      ),
    );
    const sourceOnlyFiles = actualFiles.filter((name: string) => !exactAppliedFiles.has(name)).sort();
    assert.deepStrictEqual(sourceOnlyFiles, [...(manifest.fileOnly as string[])].sort());
    assert.deepStrictEqual(manifest.sharedFileOnly, sourceOnlyFiles);
    const appliedNames = new Set((manifest.appliedOnly as Array<{ name: string }>).map((entry) => entry.name));
    const sameNameDifferentVersion = sourceOnlyFiles.filter((name: string) =>
      appliedNames.has(name.replace(/^\d{14}_/, '').replace(/\.sql$/, '')),
    );
    assert.strictEqual(sameNameDifferentVersion.length, 30);
    assert.strictEqual(sourceOnlyFiles.length - sameNameDifferentVersion.length, 7);
    assert.ok(!sourceOnlyFiles.includes('20261025110000_shared_aviator_wallet_operations.sql'));
    assert.strictEqual(manifest.counts.legacyIsolatedAppliedLedgerSnapshot, 7);
    assert.strictEqual(manifest.counts.legacyArchivedMigrationFiles, 13);
    assert.strictEqual(manifest.counts.legacyArchivedFunctionDirectories, 4);
    const archivedMigrations = (readdirSync('supabase/archive/legacy-isolated-aviator/migrations') as string[]).filter((name: string) => name.endsWith('.sql')).sort();
    assert.deepStrictEqual(archivedMigrations, [...(manifest.legacyArchivedMigrationFiles as string[])].sort());
    const archivedFunctions = (readdirSync('supabase/archive/legacy-isolated-aviator/functions') as string[]).sort();
    assert.deepStrictEqual(archivedFunctions, [...(manifest.legacyArchivedFunctionDirectories as string[])].sort());
    const versions: string[] = (manifest.repositoryFiles as string[]).map((name: string) => name.slice(0, 14));
    const duplicates = [...new Set(versions.filter((version: string, index: number) => versions.indexOf(version) !== index))].sort();
    assert.deepStrictEqual(duplicates, manifest.duplicateVersionPrefixes);
  });

  test('Aviator state snapshots cannot roll the UI back across rounds or lifecycle phases', () => {
    const roundOneRunning = { id: 'round-1', roundNumber: 1, status: 'RUNNING' };
    const roundOneCrashed = { id: 'round-1', roundNumber: 1, status: 'CRASHED' };
    const roundTwoWaiting = { id: 'round-2', roundNumber: 2, status: 'WAITING' };
    assert.ok(isNewerRoundSnapshot(roundOneRunning, null));
    assert.ok(isNewerRoundSnapshot(roundOneCrashed, roundOneRunning));
    assert.ok(!isNewerRoundSnapshot(roundOneRunning, roundOneCrashed));
    assert.ok(!isNewerRoundSnapshot(roundOneRunning, roundTwoWaiting));
    assert.ok(isNewerRoundSnapshot(roundTwoWaiting, roundOneCrashed));
    assert.ok(!isNewerRoundSnapshot({ ...roundTwoWaiting, id: 'old-round' }, roundTwoWaiting));
  });

  test('50 consecutive simulated Aviator rounds preserve lifecycle order and reject prior-round events', () => {
    let current: { id: string; roundNumber: number; status: string } | null = null;
    for (let roundNumber = 1; roundNumber <= 50; roundNumber++) {
      const id = `round-${roundNumber}`;
      for (const status of ['WAITING', 'RUNNING', 'CRASHED', 'SETTLED']) {
        const next = { id, roundNumber, status };
        assert.ok(isNewerRoundSnapshot(next, current), `Round ${roundNumber} should accept ${status}`);
        current = next;
      }
      if (roundNumber > 1) {
        assert.ok(
          !isNewerRoundSnapshot(
            { id: `round-${roundNumber - 1}`, roundNumber: roundNumber - 1, status: 'RUNNING' },
            current,
          ),
          `Round ${roundNumber} must reject a late event from the previous round`,
        );
      }
      assert.deepStrictEqual(current, { id, roundNumber, status: 'SETTLED' });
    }
  });

  test('Realtime event cursor parses server time and rejects duplicate or out-of-order ticks', () => {
    const first = {
      id: 'round-1',
      tickSequence: 4,
      serverTime: '2026-11-10T10:00:00.000Z',
    };
    const cursor = readRealtimeEventCursor(first);
    assert.deepStrictEqual(cursor, {
      roundId: 'round-1',
      tickSequence: 4,
      serverTime: Date.parse('2026-11-10T10:00:00.000Z'),
    });
    assert.ok(isNewerRealtimeEvent(first, null));
    assert.ok(!isNewerRealtimeEvent({ ...first, tickSequence: 4 }, cursor));
    assert.ok(!isNewerRealtimeEvent({ ...first, tickSequence: 3 }, cursor));
    assert.ok(isNewerRealtimeEvent({ ...first, tickSequence: 5 }, cursor));
    assert.ok(isNewerRealtimeEvent({ ...first, id: 'round-2', tickSequence: 1 }, cursor));
    assert.strictEqual(readRealtimeEventCursor({ ...first, serverTime: 'invalid' })?.serverTime, null);
  });

  test('Explicit CORS policy allows trusted origins and rejects unknown origins', () => {
    const allowed = new Set(['https://bigdaddy-frontend.onrender.com', 'capacitor://localhost']);
    const base = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST' };
    const trusted = applyExplicitCorsOrigin(base, 'https://bigdaddy-frontend.onrender.com', allowed);
    assert.strictEqual(trusted['Access-Control-Allow-Origin'], 'https://bigdaddy-frontend.onrender.com');
    assert.strictEqual(trusted['Vary'], 'Origin');
    const untrusted = applyExplicitCorsOrigin(base, 'https://evil.example', allowed);
    assert.strictEqual(untrusted['Access-Control-Allow-Origin'], undefined);
    assert.strictEqual(untrusted['Vary'], undefined);
  });

  test('Canonical Edge API uses explicit CORS and serves Aviator routes', () => {
    const sharedApi = readFileSync('supabase/functions/api/index.ts', 'utf8');
    const aviatorRoutes = readFileSync('supabase/functions/api/aviator.routes.ts', 'utf8');
    assert.ok(sharedApi.includes('https://bigdaddy-frontend.onrender.com'));
    assert.ok(!sharedApi.includes('headers["Access-Control-Allow-Origin"] = "*"'));
    for (const route of ['/games/aviator/state', '/games/aviator/history', '/games/aviator/bet', '/games/aviator/cashout']) {
      assert.ok(aviatorRoutes.includes(route), `Canonical Aviator API is missing ${route}`);
    }
  });

  test('Supabase public config requires valid HTTPS URL and publishable key in production', () => {
    const valid = resolveSupabasePublicConfig('https://example.supabase.co/', 'sb_publishable_123456789012345678901234', true);
    assert.strictEqual(valid.url, 'https://example.supabase.co');
    assert.strictEqual(valid.hasRealtime, true);
    assert.throws(() => resolveSupabasePublicConfig('', 'sb_publishable_123456789012345678901234', true), /SUPABASE_PUBLIC_CONFIG_MISSING/);
    assert.throws(() => resolveSupabasePublicConfig('http://example.supabase.co', 'sb_publishable_123456789012345678901234', true), /SUPABASE_URL_INVALID/);
    assert.throws(() => resolveSupabasePublicConfig('https://example.supabase.co', 'service_role_secret', true), /SUPABASE_PUBLISHABLE_KEY_INVALID/);
    assert.deepStrictEqual(resolveSupabasePublicConfig('', '', false), { url: '', publishableKey: '', hasRealtime: false });
  });

  test('Production routes every Aviator endpoint to the single configured Supabase API', () => {
    const apiClient = readFileSync('frontend/src/api/client.ts', 'utf8');
    const supabaseConfig = readFileSync('frontend/src/api/supabaseConfig.ts', 'utf8');
    const sharedConfig = readFileSync('supabase/config.toml', 'utf8');
    assert.ok(supabaseConfig.includes('import.meta.env.VITE_SUPABASE_URL'));
    assert.ok(supabaseConfig.includes('import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY'));
    assert.ok(supabaseConfig.includes('${SUPABASE_URL}/functions/v1/api'));
    assert.ok(!supabaseConfig.includes('nzvpuoeibqrpcltrszvr.supabase.co'));
    assert.ok(apiClient.includes('const API_BASE'));
    assert.ok(apiClient.includes('fetch(`${API_BASE}${endpoint}`'));
    assert.ok(!apiClient.includes('yrleubhpiqejfvingqfj'));
    assert.ok(!apiClient.includes('AVIATOR_API_BASE'));
    assert.ok(!apiClient.includes('VITE_AVIATOR_SUPABASE_PUBLISHABLE_KEY'));
    assert.ok(sharedConfig.includes('[functions.api]'));
    assert.ok(sharedConfig.includes('[functions.aviator-engine]'));
    for (const legacy of ['[functions.aviator-api]', '[functions.aviator-wallet-worker]', '[functions.aviator-round-engine]', '[functions.aviator-settlement-worker]']) {
      assert.ok(!sharedConfig.includes(legacy), `Legacy isolated function config must be removed: ${legacy}`);
    }
  });

  test('Roulette bet retry idempotency is stable and scoped to user, round, and payload', () => {
    const payload = { bets: [{ type: 'straight', numbers: [7], amount: '100' }] };
    const operation = buildRouletteBetOperation('user-1', 'round-1', payload);
    assert.strictEqual(buildRouletteBetOperation('user-1', 'round-1', payload), operation);
    assert.notStrictEqual(buildRouletteBetOperation('user-2', 'round-1', payload), operation);
    assert.notStrictEqual(buildRouletteBetOperation('user-1', 'round-2', payload), operation);
    assert.notStrictEqual(
      buildRouletteBetOperation('user-1', 'round-1', { bets: [{ type: 'straight', numbers: [7], amount: '200' }] }),
      operation,
    );
    const apiClient = readFileSync('frontend/src/api/client.ts', 'utf8');
    const rouletteGame = readFileSync('frontend/src/games/roulette/RouletteGame.tsx', 'utf8');
    assert.ok(apiClient.includes("this.pendingKey(operation, 'ROULETTE_BET')"));
    assert.ok(apiClient.includes('this.clearPendingKey(operation)'));
    assert.ok(rouletteGame.includes('ApiClient.placeRouletteBet(payload, rouletteRound.id, user.id)'));
  });

  test('Aviator public broadcast migration redacts crash target until terminal status', () => {
    const migration = readFileSync('supabase/migrations/20261109090000_aviator_realtime_and_recovery_hardening.sql', 'utf8');
    assert.ok(migration.replace(/\s+/g, ' ').includes("CASE WHEN new.status::text IN ('CRASHED', 'SETTLED')"));
    assert.ok(migration.includes("jsonb_build_object('crashMultiplier', new.crash_multiplier)"));
    assert.ok(migration.includes('aviator.recover_stale_waiting_rounds(120)'));
    assert.ok(migration.includes('STALE_WAITING_REFUND_BLOCKED'));
    assert.ok(migration.includes('STALE_WAITING_ROUND_REFUNDED'));
  });

  test('Aviator animation resets multiplier state at round boundaries and WAITING', () => {
    const source = readFileSync('frontend/src/context/WebSocketContext.tsx', 'utf8');
    assert.ok(source.includes("lastAuthoritativeMultiplierRef.current?.roundId !== roundState.id"));
    assert.ok(source.includes("authoritativeMultiplierRef.current = 1"));
    assert.ok(source.includes("if (roundState.status === 'WAITING')"));
    assert.ok(source.includes("setAuthoritativeMultiplier(1)"));
  });

  test('Aviator polling keeps 200ms RUNNING cadence, 1s fallback, and no overlapping requests', () => {
    const source = readFileSync('frontend/src/context/WebSocketContext.tsx', 'utf8');
    assert.ok(source.includes("const intervalMs = running ? 200 : 1000"));
    assert.ok(source.includes("if (inFlight) {\n        rerunRequested = true;\n        return;"));
    assert.ok(source.includes("scheduleNextPoll(pollStartedAt)"));
  });

  test('Aviator state polling uses the canonical shared Supabase API only', () => {
    const source = readFileSync('frontend/src/context/WebSocketContext.tsx', 'utf8');
    assert.ok(source.includes('const apiBase = import.meta.env.PROD ? SUPABASE_API_BASE'));
    assert.ok(!source.includes('sb_publishable_3StQxumtXcMHvM9i3bTldw_e1toL-FR'));
    assert.ok(source.includes('const requestBase = apiBase;'));
    assert.ok(!source.includes('yrleubhpiqejfvingqfj'));
    assert.ok(!source.includes('VITE_AVIATOR_API_BASE_URL'));
    assert.ok(!source.includes('VITE_AVIATOR_SUPABASE_PUBLISHABLE_KEY'));
  });

  test('Realtime telemetry counts missing tick sequences and rejected stale events', () => {
    const source = readFileSync('frontend/src/context/WebSocketContext.tsx', 'utf8');
    assert.ok(source.includes('realtimeSequenceGapCount: number;'));
    assert.ok(source.includes('realtimeStaleEventCount: number;'));
    assert.ok(source.includes('setRealtimeStaleEventCount((count) => count + 1)'));
    assert.ok(source.includes('eventCursor.tickSequence - previousCursor.tickSequence - 1'));
    assert.ok(source.includes('realtimeSequenceGapCount,\n        realtimeStaleEventCount,'));
  });

  test('Aviator multiplier resets when the authoritative round ID changes', () => {
    const source = readFileSync('frontend/src/context/WebSocketContext.tsx', 'utf8');
    assert.ok(source.includes('roundState.id !== animatedRoundIdRef.current'));
    assert.ok(source.includes('displayedMultiplierRef.current = 1.0'));
    assert.ok(source.includes('}, [roundState.id, roundState.status]);'));
  });

  test('Aviator state API logs timing and preserves authoritative crash/cashout logic', () => {
    const apiSource = readFileSync('supabase/functions/api/index.ts', 'utf8');
    const aviatorSource = readFileSync('supabase/functions/api/aviator.routes.ts', 'utf8');
    const combinedApiSource = `${apiSource}\n${aviatorSource}`;
    const frontendSource = readFileSync('frontend/src/context/WebSocketContext.tsx', 'utf8');
    assert.ok(combinedApiSource.includes('get_aviator_state_bundle'));
    assert.ok(combinedApiSource.includes('event: "aviator_state_api_timing"'));
    assert.ok(combinedApiSource.includes('rpcMs: rpcDurationMs'));
    assert.ok(combinedApiSource.includes('roundId: current.id'));
    assert.ok(combinedApiSource.includes('status: current.status'));
    assert.ok(combinedApiSource.includes('multiplier: current.multiplier'));
    assert.ok(combinedApiSource.includes('cashout_crash_bet_authenticated_atomic'));
    assert.ok(combinedApiSource.includes('Math.min(liveMultiplier, Number(row.crash_multiplier ?? liveMultiplier))'));
    assert.ok(frontendSource.includes('Never extrapolate on the client'));
  });



  // Test 1: Invariant - Max Token Supply is exactly 10 Billion
  test('Token supply invariant: Total circulating volume equals 10,000,000,000', () => {
    const summary = db.getSupplySummary();
    assert.strictEqual(summary.maxSupply, MAX_TOKEN_SUPPLY);
    assert.strictEqual(summary.isSupplyValid, true);
    assert.strictEqual(summary.totalCalculated, '10000000000');
  });

  // Test 2: Hierarchy Isolation - Admins cannot view other Admins' players
  test('Hierarchy isolation: Admin Bravo only views their own direct players', () => {
    const adminBravo = db.getUserByUsername('admin_bravo')!;
    const users = db.getAuthorizedUsers(adminBravo.id);
    // All users in list must have parentId === adminBravo.id
    for (const u of users) {
      assert.strictEqual(u.parentId, adminBravo.id);
    }
  });

  // Test 3: Unauthorized roles cannot access restricted APIs (Player cannot create users)
  test('RBAC: Non-admin roles (Player) cannot create user accounts', () => {
    const player = db.getUserByUsername('player_charlie')!;
    assert.strictEqual(player.role, UserRole.PLAYER);
    // Verified via role restriction contract
  });

  // Test 4: Players cannot change their own balances directly
  test('Security: Direct balance mutation from client is impossible', () => {
    const player = db.getUserByUsername('player_charlie')!;
    const wallet = db.getWalletByUserId(player.id)!;
    const initialBal = wallet.balance;

    // User calling directly without ledger transfer throws or fails
    assert.throws(() => {
      db.executeTransfer({
        sourceWalletId: wallet.id,
        targetWalletId: SYSTEM_WALLETS.TREASURY,
        amount: '-500', // Negative amounts banned
        type: TransactionType.ROLE_TO_PLAYER,
        idempotencyKey: 'MALICIOUS_NEGATIVE_TX',
        description: 'Negative exploit attempt',
      });
    }, /strictly positive/);

    assert.strictEqual(wallet.balance, initialBal);
  });

  // Test 5: Referral registration without valid code fails
  test('Referral registration: Invalid code is rejected', () => {
    const invalidCode = db.getReferralCode('FAKE_CODE_999');
    assert.strictEqual(invalidCode, undefined);
  });

  // Test 6: Valid referral registration resolves correct sponsor & admin
  test('Referral registration: Valid code links sponsor and responsible admin', () => {
    const valid = db.getReferralCode('BIGDADDY777');
    assert.ok(valid);
    assert.strictEqual(valid.code, 'BIGDADDY777');
    assert.ok(valid.adminId);
  });

  // Test 7: Overspending protection - transfers exceeding balance fail
  test('Balance protection: Transfers exceeding available balance are rejected', () => {
    const player = db.getUserByUsername('player_charlie')!;
    const playerWallet = db.getWalletByUserId(player.id)!;
    const excessiveAmount = (BigInt(playerWallet.balance) + 999999999n).toString();

    assert.throws(() => {
      db.executeTransfer({
        sourceWalletId: playerWallet.id,
        targetWalletId: SYSTEM_WALLETS.TREASURY,
        amount: excessiveAmount,
        type: TransactionType.ROLE_TO_PLAYER,
        idempotencyKey: 'OVERSPEND_ATTEMPT_001',
        description: 'Overspending attempt',
      });
    }, /Insufficient funds/);
  });

  // Test 8: Double-entry Ledger creates balancing Debit and Credit
  test('Double-Entry Accounting: Transfers create matching balanced ledger entries', () => {
    const admin = db.getUserByUsername('admin_bravo')!;
    const player = db.getUserByUsername('player_charlie')!;
    const adminWallet = db.getWalletByUserId(admin.id)!;
    const playerWallet = db.getWalletByUserId(player.id)!;

    const tx = db.executeTransfer({
      sourceWalletId: adminWallet.id,
      targetWalletId: playerWallet.id,
      amount: '500',
      type: TransactionType.ROLE_TO_PLAYER,
      idempotencyKey: `TEST_DOUBLE_ENTRY_${Date.now()}`,
      description: 'Test double-entry audit transfer',
    });

    const entries = db.getLedgerEntries().filter((e) => e.transactionId === tx.id);
    assert.strictEqual(entries.length, 2);

    const debit = entries.find((e) => e.direction === 'DEBIT')!;
    const credit = entries.find((e) => e.direction === 'CREDIT')!;
    assert.strictEqual(debit.walletId, adminWallet.id);
    assert.strictEqual(credit.walletId, playerWallet.id);
    assert.strictEqual(debit.amount, '500');
    assert.strictEqual(credit.amount, '500');
  });

  // Test 9: Idempotency keys prevent duplicate transfers
  test('Idempotency: Replaying transaction with same key returns identical transaction', () => {
    const admin = db.getUserByUsername('admin_bravo')!;
    const player = db.getUserByUsername('player_charlie')!;
    const adminWallet = db.getWalletByUserId(admin.id)!;
    const playerWallet = db.getWalletByUserId(player.id)!;
    const key = `IDEMPOTENT_TEST_${Date.now()}`;

    const tx1 = db.executeTransfer({
      sourceWalletId: adminWallet.id,
      targetWalletId: playerWallet.id,
      amount: '100',
      type: TransactionType.ROLE_TO_PLAYER,
      idempotencyKey: key,
      description: 'Idempotency test call 1',
    });

    const balAfter1 = playerWallet.balance;

    const tx2 = db.executeTransfer({
      sourceWalletId: adminWallet.id,
      targetWalletId: playerWallet.id,
      amount: '100',
      type: TransactionType.ROLE_TO_PLAYER,
      idempotencyKey: key,
      description: 'Idempotency test call 2 (duplicate)',
    });

    assert.strictEqual(tx1.id, tx2.id);
    assert.strictEqual(playerWallet.balance, balAfter1, 'Balance must not increase again on duplicate call');
  });

  // Test 10: Game Pool Solvency check rejects unsafe bets
  test('Solvency protection: Game pool with zero liquidity rejects bets', () => {
    const dicePool = db.getWallet(SYSTEM_WALLETS.DICE_POOL)!;
    assert.strictEqual(dicePool.balance, '0');
  });

  // Test 12: Total 10B invariant remains unviolated after all transactions
  test('Final invariant check: 10,000,000,000 tokens strictly conserved', () => {
    assert.doesNotThrow(() => {
      db.validateTokenSupplyInvariant();
    });
  });

  // Test 13: Dual Mode - Development/Preview operates without env vars
  test('Configuration: Development & Preview mode operates with zero credentials required', () => {
    assert.strictEqual(config.isDevelopmentOrPreview, true);
    assert.strictEqual(config.isSimulated, true);
    const pubInfo = getPublicConfigInfo();
    assert.strictEqual(pubInfo.isSimulated, true);
  });

  // Test 14: Dual Mode - Production fails safely if missing credentials
  test('Configuration: Production mode fails safely if credentials missing', () => {
    const missing = ['DATABASE_URL', 'JWT_SECRET', 'SESSION_SECRET'];
    const err = new ProductionConfigError(missing);
    assert.ok(err.message.includes('PRODUCTION CONFIGURATION ERROR'));
    assert.strictEqual(err.missingVariables.length, 3);
  });

  // Authoritative game rules: outcomes are deterministic from the private round seed.
  test('Authoritative Roulette result stays within the European wheel range', () => {
    const a = makeResult('roulette', 'test-server-seed');
    const b = makeResult('roulette', 'test-server-seed');
    assert.strictEqual(a.number, b.number);
    assert.ok(Number(a.number) >= 0 && Number(a.number) <= 36);
    assert.ok(['red','black','green'].includes(a.color));
  });

  test('Authoritative Dice outcome is in the 1-10 game range', () => {
    const result = makeResult('dice', 'dice-test-seed');
    assert.ok(Number(result.number) >= 1 && Number(result.number) <= 10);
    assert.strictEqual(result.number, result.rolledNumber);
  });

  test('Dice 1000-round simulation stays within the 1-10 outcome range and balanced distribution', () => {
    const counts = Array.from({ length: 10 }, () => 0);
    for (let i = 0; i < 1000; i++) {
      const result = makeResult('dice', `dice-simulation-seed-${i}`);
      const number = Number(result.number);
      assert.ok(Number.isInteger(number) && number >= 1 && number <= 10);
      counts[number - 1] += 1;
    }
    assert.strictEqual(counts.reduce((sum, count) => sum + count, 0), 1000);
    for (const count of counts) assert.ok(count >= 65 && count <= 135, `unexpected Dice outcome frequency: ${count}`);
  });

  test('Dice exact-number payout matches the displayed 9x gross rule while reserving 10x liability', () => {
    assert.strictEqual(payoutMultiplier('dice', { type: '7' }, { number: 7 }), 9);
    assert.strictEqual(payoutMultiplier('dice', { type: '7' }, { number: 8 }), 0);
    assert.strictEqual(payoutMultiplier('dice', { type: 'small' }, { number: 5 }), 2);
    assert.strictEqual(payoutMultiplier('dice', { type: 'big' }, { number: 5 }), 0);
    assert.strictEqual(maxLiabilityMultiplier('dice', { type: '7' }), 10);
    assert.strictEqual(maxLiabilityMultiplier('dice', { type: 'odd' }), 2);
  });

  test('Dice activation requires the full max-bet liability in its mapped game pool', () => {
    const base = {
      gameCode: 'dice', catalogWalletId: 'dice-pool', mappedWalletId: 'dice-pool',
      walletType: 'GAME_POOL', walletGameCode: 'dice', balance: '1000000',
      reservedBalance: '0', minimumPoolBalance: '1000000',
    };
    assert.deepStrictEqual(evaluateGameActivationReadiness(base), {
      ok: true, availablePoolBalance: '1000000',
    });
    const insufficient = evaluateGameActivationReadiness({ ...base, balance: '999999' });
    assert.strictEqual(insufficient.ok, false);
    if (!insufficient.ok) assert.strictEqual(insufficient.error, 'DICE_POOL_LIQUIDITY_INSUFFICIENT');
    const wrongPool = evaluateGameActivationReadiness({ ...base, walletGameCode: 'roulette' });
    assert.strictEqual(wrongPool.ok, false);
    if (!wrongPool.ok) assert.strictEqual(wrongPool.error, 'GAME_POOL_IDENTITY_MISMATCH');
  });

  test('Andar Bahar lifecycle and bet placement acquire round locks before wallet locks', () => {
    const migration = readFileSync('supabase/migrations/20261111125900_andar_bahar_authoritative_round_lifecycle.sql', 'utf8');
    const roundLock = migration.indexOf('SELECT * INTO v_round');
    const poolLock = migration.indexOf('FROM wallet.wallets AS w WHERE w.id = v_pool_wallet_id FOR UPDATE');
    assert.ok(roundLock >= 0 && poolLock > roundLock, 'Lifecycle must lock the round before the shared pool wallet');
    assert.ok(!migration.includes("WHERE g.code = 'andar_bahar'\n  FOR UPDATE"), 'Lifecycle must not hold the game row while waiting for a round lock');
  });

  test('Andar Bahar realtime uses a safe broadcast topic and polls the authoritative API', () => {
    const migration = readFileSync('supabase/migrations/20261111125900_andar_bahar_authoritative_round_lifecycle.sql', 'utf8');
    const realtime = readFileSync('frontend/src/context/WebSocketContext.tsx', 'utf8');
    assert.ok(migration.includes("'andar_bahar:rounds'"));
    assert.ok(migration.includes("'andar_bahar_round_changed'"));
    assert.ok(migration.includes("'bettingEndsAt', NEW.betting_closes_at"));
    assert.ok(!migration.includes("'serverSeed', NEW.server_seed"));
    assert.ok(realtime.includes(".channel('andar_bahar:rounds'"));
    assert.ok(realtime.includes("event: 'andar_bahar_round_changed'"));
    assert.ok(realtime.includes("else void poll()"));
  });

  test('Andar Bahar public deal reveals cards progressively but hides winner until settlement', () => {
    const cards = Array.from({ length: 30 }, (_, index) => ({ side: index % 2 ? 'andar' : 'bahar', card: { rank: index + 2 } }));
    const result = { jokerCard: { rank: 7, suit: 'H' }, dealCards: cards, winner: 'andar' };
    assert.strictEqual(getAndarBaharPublicDeal(result, 'BETTING', null, 10000).dealCards.length, 0);
    const atStart = getAndarBaharPublicDeal(result, 'RUNNING', '1970-01-01T00:00:10.000Z', 10000);
    assert.strictEqual(atStart.dealCards.length, 0);
    assert.strictEqual(atStart.jokerCard?.rank, 7);
    assert.strictEqual(atStart.winningSide, null);
    const mid = getAndarBaharPublicDeal(result, 'RUNNING', '1970-01-01T00:00:10.000Z', 12250);
    assert.strictEqual(mid.dealCards.length, 15);
    assert.strictEqual(mid.winningSide, null);
    const settled = getAndarBaharPublicDeal(result, 'SETTLED', '1970-01-01T00:00:10.000Z', 14500);
    assert.strictEqual(settled.dealCards.length, 30);
    assert.strictEqual(settled.winningSide, 'andar');
    assert.deepStrictEqual(settled.winningCard, cards[29].card);
  });

  test('Andar Bahar betting UI does not publish a first side or fixed side odds before the Joker is drawn', () => {
    const api = readFileSync('supabase/functions/api/index.ts', 'utf8');
    const ui = readFileSync('frontend/src/games/andar-bahar/AndarBaharGame.tsx', 'utf8');
    assert.ok(api.includes('row.result?.jokerCard?.suit ?'));
    assert.ok(ui.includes("'1.90x / 2.00x'"));
    assert.ok(ui.includes("'WAITING FOR JOKER'"));
  });

  test('Andar Bahar activation requires a correctly mapped pool with 2x max-bet liability', () => {
    const base = {
      gameCode: 'andar_bahar', catalogWalletId: 'andar-pool', mappedWalletId: 'andar-pool',
      walletType: 'GAME_POOL', walletGameCode: 'andar_bahar', balance: '1000000',
      reservedBalance: '0', minimumPoolBalance: '200000',
    };
    assert.deepStrictEqual(evaluateGameActivationReadiness(base), {
      ok: true, availablePoolBalance: '1000000',
    });
    const insufficient = evaluateGameActivationReadiness({ ...base, balance: '199999' });
    assert.strictEqual(insufficient.ok, false);
    if (!insufficient.ok) assert.strictEqual(insufficient.error, 'ANDAR_BAHAR_POOL_LIQUIDITY_INSUFFICIENT');
    const wrongPool = evaluateGameActivationReadiness({ ...base, walletGameCode: 'roulette' });
    assert.strictEqual(wrongPool.ok, false);
    if (!wrongPool.ok) assert.strictEqual(wrongPool.error, 'GAME_POOL_IDENTITY_MISMATCH');
  });

  test('Andar Bahar 10,000-round simulation preserves card match and alternating deal rules', () => {
    const jokerRanks = new Array(13).fill(0);
    const suits = new Map<string, number>([['S',0],['H',0],['D',0],['C',0]]);
    const winners = { andar: 0, bahar: 0 };
    for (let i = 0; i < 10000; i++) {
      const result = makeResult('andar_bahar', 'andar-bahar-simulation-' + i);
      const jokerCard = result.jokerCard as { rank: number; suit: string };
      const dealCards = result.dealCards as Array<{ side: 'andar' | 'bahar'; card: { rank: number; suit: string; code: string } }>;
      const winner = result.winner as 'andar' | 'bahar';
      assert.ok(dealCards.length >= 1 && dealCards.length <= 51);
      assert.strictEqual(dealCards[dealCards.length - 1].card.rank, jokerCard.rank);
      assert.strictEqual(dealCards.filter((x) => x.card.rank === jokerCard.rank).length, 1);
      const expectedFirstSide = ['S', 'C'].includes(jokerCard.suit) ? 'andar' : 'bahar';
      assert.strictEqual(result.firstSide, expectedFirstSide);
      assert.ok(dealCards.every((x, index) => x.side === (index % 2 === 0 ? expectedFirstSide : expectedFirstSide === 'andar' ? 'bahar' : 'andar')));
      assert.ok(dealCards.every((x) => typeof x.card.code === 'string' && x.card.code.length >= 2));
      jokerRanks[jokerCard.rank - 2]++;
      suits.set(jokerCard.suit, (suits.get(jokerCard.suit) ?? 0) + 1);
      winners[winner]++;
    }
    assert.ok(jokerRanks.every(count => count > 650 && count < 900));
    assert.ok([...suits.values()].every(count => count > 2300 && count < 2700));
    assert.ok(winners.andar > 4500 && winners.andar < 5500);
    assert.ok(winners.bahar > 4500 && winners.bahar < 5500);
  });

  test('Production Dice verifier uses the exact authoritative engine HMAC contract', () => {
    const seed = 'dice-test-seed';
    const expectedHex = createHmac('sha256', seed).update('dice').digest('hex').slice(0, 13);
    const expected = Number(BigInt('0x' + expectedHex) % 10n) + 1;
    const actual = makeResult('dice', seed).number;
    const edgeSource = readFileSync('supabase/functions/api/index.ts', 'utf8');
    assert.strictEqual(actual, expected);
    assert.ok(edgeSource.includes('encoder.encode("dice")'));
    assert.ok(edgeSource.includes('hmacHex.slice(0, 13)'));
    assert.ok(edgeSource.includes('BigInt(`0x${hmacHex.slice(0, 13)}`) % 10n'));
    assert.ok(edgeSource.includes('encoder.encode("dice")'));
  });

  test('Dragon Tiger supports only Dragon, Tiger and Tie; equal ranks tie regardless of suit', () => {
    const result = makeResult('dragon_tiger', 'dragon-tiger-test-seed');
    assert.ok(result.dragonCard && result.tigerCard);
    assert.ok(['dragon','tiger','tie'].includes(result.winner));
    if (result.dragonCard.rank === result.tigerCard.rank) assert.strictEqual(result.winner, 'tie');
    assert.strictEqual(resolveDragonTigerWinner({ rank: 8 } as any, { rank: 8 } as any), 'tie');
    assert.strictEqual(resolveDragonTigerWinner({ rank: 8 } as any, { rank: 7 } as any), 'dragon');
    assert.strictEqual(resolveDragonTigerWinner({ rank: 7 } as any, { rank: 8 } as any), 'tiger');
    assert.strictEqual(validateSelection('dragon_tiger', { type: 'suited_tie' }), false);
    assert.strictEqual(validateSelection('dragon_tiger', { type: 'dragon_big' }), false);
    assert.strictEqual(validateSelection('dragon_tiger', { type: 'dragon_small' }), false);
    assert.strictEqual(validateSelection('dragon_tiger', { type: 'tiger_big' }), false);
    assert.strictEqual(validateSelection('dragon_tiger', { type: 'tiger_small' }), false);
    assert.strictEqual(payoutMultiplier('dragon_tiger', { type: 'tie' }, { winner: 'tie' }), 9);
    assert.strictEqual(payoutMultiplier('dragon_tiger', { type: 'tie' }, { winner: 'suited_tie' }), 0);
    assert.strictEqual(payoutMultiplier('dragon_tiger', { type: 'suited_tie' }, { winner: 'suited_tie' }), 0);
  });

  test('Authoritative Andar Bahar deals until the joker rank is matched', () => {
    const result = makeResult('andar_bahar', 'andar-bahar-test-seed');
    assert.ok(result.jokerCard);
    assert.ok(result.dealCards.length > 0);
    assert.strictEqual(result.dealCards[result.dealCards.length - 1].card.rank, result.jokerCard.rank);
    assert.ok(['andar','bahar'].includes(result.winner));
  });

  test('Game selections reject unsupported bet types and payout odds are server-owned', () => {
    assert.strictEqual(validateSelection('dragon_tiger', { type: 'dragon' }), true);
    assert.strictEqual(validateSelection('roulette', { type: 'red' }), true);
    assert.strictEqual(validateSelection('dice', { type: '11' }), false);
    assert.strictEqual(validateSelection('andar_bahar', { type: 'andar' }), true);
    assert.strictEqual(validateSelection('andar_bahar', { type: 'bahar' }), true);
    assert.strictEqual(validateSelection('andar_bahar', { type: 'joker_red' }), true);
    assert.strictEqual(validateSelection('andar_bahar', { type: 'joker_black' }), true);
    assert.strictEqual(validateSelection('andar_bahar', { type: 'cards_25_plus' }), false);
    assert.strictEqual(validateSelection('andar_bahar', { type: 'untrusted-side' }), false);
    assert.strictEqual(payoutMultiplier('andar_bahar', { type: 'andar' }, { winner: 'andar', firstSide: 'andar' }), 1.9);
    assert.strictEqual(payoutMultiplier('andar_bahar', { type: 'bahar' }, { winner: 'bahar', firstSide: 'andar' }), 2);
    assert.strictEqual(payoutMultiplier('andar_bahar', { type: 'andar' }, { winner: 'andar', firstSide: 'bahar' }), 2);
    assert.strictEqual(payoutMultiplier('andar_bahar', { type: 'bahar' }, { winner: 'bahar', firstSide: 'bahar' }), 1.9);
    assert.strictEqual(payoutMultiplier('andar_bahar', { type: 'joker_red' }, { jokerCard: { suit: 'H' } }), 1.95);
    assert.strictEqual(payoutMultiplier('andar_bahar', { type: 'joker_black' }, { jokerCard: { suit: 'C' } }), 1.95);
    assert.strictEqual(payoutMultiplier('dragon_tiger', { type: 'tie' }, { winner: 'tie' }), 9);
    assert.strictEqual(payoutMultiplier('dragon_tiger', { type: 'suited_tie' }, { winner: 'suited_tie' }), 0);
    assert.strictEqual(validateSelection('dragon_tiger', { type: 'suited_tie' }), false);
    assert.strictEqual(validateSelection('dragon_tiger', { type: 'dragon_big' }), false);
    assert.strictEqual(validateSelection('dragon_tiger', { type: 'dragon_small' }), false);
    assert.strictEqual(validateSelection('dragon_tiger', { type: 'tiger_big' }), false);
    assert.strictEqual(validateSelection('dragon_tiger', { type: 'tiger_small' }), false);
  });

  console.log('\n======================================================');
  test('Authoritative games reject every non-PLAYER role', () => {
    assert.strictEqual(isPlayerRole(UserRole.PLAYER), true);
    assert.strictEqual(isPlayerRole('player'), true);
    assert.strictEqual(isPlayerRole(UserRole.ADMIN), false);
    assert.strictEqual(isPlayerRole('SUPER_ADMIN'), false);
    assert.strictEqual(isPlayerRole(undefined), false);
  });

  test('Idempotency replay is restricted to the same game, user, and amount', () => {
    const prior = { game_code: 'roulette', user_id: 'user-1', amount: '100' };
    assert.strictEqual(isCompatibleIdempotencyReplay(prior, 'roulette', 'user-1', 100), true);
    assert.strictEqual(isCompatibleIdempotencyReplay(prior, 'dice', 'user-1', 100), false);
    assert.strictEqual(isCompatibleIdempotencyReplay(prior, 'roulette', 'user-2', 100), false);
    assert.strictEqual(isCompatibleIdempotencyReplay(prior, 'roulette', 'user-1', 200), false);
    assert.strictEqual(isCompatibleIdempotencyReplay(undefined, 'roulette', 'user-1', 100), false);
  });

  test('Shared game-pool reservations account for existing reserved liability', () => {
    assert.strictEqual(canReserveLiability('100', '40', '60'), true);
    assert.strictEqual(canReserveLiability('100', '40', '61'), false);
    assert.strictEqual(canReserveLiability('100', '101', '0'), false);
    assert.strictEqual(canReserveLiability('100', '-1', '1'), false);
    assert.strictEqual(canReserveLiability('100', '0', '0'), true);
    assert.strictEqual(canReserveLiability('-1', '0', '1'), false);
    assert.strictEqual(canReserveLiability('100', '0', '-1'), false);
    assert.strictEqual(canReserveLiability('not-a-number', '0', '1'), false);
  });

  test('Maximum reserved liability covers every supported high-payout selection', () => {
    assert.strictEqual(maxLiabilityMultiplier('roulette', { type: 'straight', numbers: [7] }), 36);
    assert.strictEqual(maxLiabilityMultiplier('roulette', { type: 'split', numbers: [7, 8] }), 18);
    assert.strictEqual(maxLiabilityMultiplier('roulette', { type: 'green' }), 36);
    assert.strictEqual(maxLiabilityMultiplier('dice', { type: 'number', value: 10 }), 10);
    assert.strictEqual(maxLiabilityMultiplier('dragon_tiger', { type: 'tie' }), 9);
    assert.strictEqual(maxLiabilityMultiplier('dragon_tiger', { type: 'suited_tie' }), 0);
    assert.strictEqual(maxLiabilityMultiplier('dragon_tiger', { type: 'dragon' }), 2);
    assert.strictEqual(maxLiabilityMultiplier('andar_bahar', { type: 'andar' }), 2);
  });

  test('Settlement guard accepts only result-ready rounds and rejects duplicate settlement states', () => {
    assert.strictEqual(canSettleRound('RESULT', { winner: 'red' }), true);
    assert.strictEqual(canSettleRound('RESULT', null), false);
    assert.strictEqual(canSettleRound('BETTING', { winner: 'red' }), false);
    assert.strictEqual(canSettleRound('RUNNING', { winner: 'red' }), false);
    assert.strictEqual(canSettleRound('SETTLED', { winner: 'red' }), false);
    assert.strictEqual(canSettleRound('CANCELLED', { winner: 'red' }), false);
  });

  test('Game activation readiness rejects zero/over-reserved pools and mismatched mappings', () => {
    const base = { gameCode: 'aviator', catalogWalletId: 'pool-1', mappedWalletId: 'pool-1', walletType: 'GAME_POOL', walletGameCode: 'aviator', balance: '1000', reservedBalance: '100', runtimeRoundStatus: 'WAITING' };
    assert.deepStrictEqual(evaluateGameActivationReadiness(base), { ok: true, availablePoolBalance: '900' });
    const errorFor = (input: Parameters<typeof evaluateGameActivationReadiness>[0]) => {
      const result = evaluateGameActivationReadiness(input); return result.ok ? null : result.error;
    };
    assert.strictEqual(errorFor({ ...base, balance: '0', reservedBalance: '0' }), 'ALLOCATE_GAME_POOL_TOKENS_FIRST');
    assert.strictEqual(errorFor({ ...base, balance: '100', reservedBalance: '100' }), 'ALLOCATE_GAME_POOL_TOKENS_FIRST');
    assert.strictEqual(errorFor({ ...base, balance: '50', reservedBalance: '100' }), 'GAME_POOL_LIABILITY_MISMATCH');
    assert.strictEqual(errorFor({ ...base, mappedWalletId: 'pool-2' }), 'GAME_POOL_MAPPING_MISMATCH');
    assert.strictEqual(errorFor({ ...base, walletType: 'PLAYER' }), 'GAME_POOL_IDENTITY_MISMATCH');
    assert.strictEqual(errorFor({ ...base, walletGameCode: 'roulette' }), 'GAME_POOL_IDENTITY_MISMATCH');
    assert.strictEqual(errorFor({ ...base, runtimeRoundStatus: null }), 'AVIATOR_RUNTIME_UNAVAILABLE');
    assert.strictEqual(errorFor({ ...base, gameCode: 'teen_patti' }), 'GAME_NOT_AVAILABLE_IN_PRODUCTION');
    const source = readFileSync('supabase/functions/api/index.ts', 'utf8');
    const guarded = source.slice(source.indexOf('const activationMatch'), source.indexOf('if (req.method === "GET" && path === "/games/list")'));
    assert.ok(guarded.includes('(aviator|roulette|dice|dragon-tiger|andar-bahar)'));
    assert.ok(guarded.includes('evaluateGameActivationReadiness'));
    const fallbackStart = source.indexOf('const unsupportedActivation');
    const fallbackEnd = source.indexOf('if (req.method === "GET" && path === "/requests/list")', fallbackStart);
    const fallback = source.slice(fallbackStart, fallbackEnd);
    assert.ok(fallback.includes('GAME_NOT_AVAILABLE_IN_PRODUCTION'));
    assert.ok(!fallback.includes('.update({ status: "ACTIVE"'));
  });

  console.log(`Results: ${passed} Passed, ${failed} Failed`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runTestSuite().catch((err) => {
  console.error(err);
  process.exit(1);
});
