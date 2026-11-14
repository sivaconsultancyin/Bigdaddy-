package com.bigdaddy.player

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.bigdaddy.player.data.BigDaddyApi
import com.bigdaddy.player.data.AviatorRoundState
import com.bigdaddy.player.data.GameHistoryDatabase
import com.bigdaddy.player.data.GameHistoryEntity
import com.bigdaddy.player.data.SecureSessionStore
import com.bigdaddy.player.domain.LocalDemoGameRegistry
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.UUID

private val gameNames = listOf(
    "aviator" to "Aviator",
    "dragon_tiger" to "Dragon Tiger",
    "dice" to "Lucky 10 Dice",
    "andar_bahar" to "Andar Bahar",
    "roulette" to "Roulette",
    "teen_patti" to "Teen Patti"
)

@Composable
fun BigDaddyApp() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val api = remember { BigDaddyApi() }
    val sessions = remember { SecureSessionStore(context) }
    val historyDao = remember { GameHistoryDatabase.get(context).historyDao() }
    val history by historyDao.observeAll().collectAsState(initial = emptyList())
    val engine = remember { LocalDemoGameRegistry() }

    var token by remember { mutableStateOf<String?>(null) }
    var username by remember { mutableStateOf("") }
    var role by remember { mutableStateOf("") }
    var balance by remember { mutableStateOf("—") }
    var loginName by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var tab by remember { mutableStateOf("Games") }
    var selectedGame by remember { mutableStateOf<String?>(null) }
    var lastResult by remember { mutableStateOf<String?>(null) }
    var aviatorState by remember { mutableStateOf<AviatorRoundState?>(null) }
    var aviatorError by remember { mutableStateOf<String?>(null) }
    var aviatorLoading by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        val saved = sessions.read()
        if (saved != null) {
            runCatching {
                val account = api.verifySession(saved)
                val currentBalance = api.walletBalance(saved)
                token = saved
                username = account.username
                role = account.role
                balance = currentBalance
            }.onFailure { failure ->
                val message = failure.message.orEmpty()
                if (listOf("AUTH_REQUIRED", "INVALID_TOKEN", "USER_NOT_FOUND_OR_DISABLED", "TOKEN_ROLE_STALE")
                        .any { message.contains(it, ignoreCase = true) }) {
                    sessions.clear()
                    token = null
                    username = ""
                    role = ""
                    balance = "—"
                    error = "Your session expired. Please sign in again."
                } else {
                    error = "Saved session could not be verified: $message"
                }
            }
        }
    }

    LaunchedEffect(token, selectedGame) {
        if (token != null && selectedGame == "aviator") {
            aviatorLoading = true
            aviatorError = null
            while (true) {
                runCatching { api.aviatorState(token!!) }
                    .onSuccess {
                        aviatorState = it
                        aviatorError = null
                    }
                    .onFailure {
                        aviatorError = it.message ?: "Aviator state unavailable."
                    }
                aviatorLoading = false
                delay(1_000)
            }
        } else {
            aviatorState = null
            aviatorError = null
            aviatorLoading = false
        }
    }

    MaterialTheme {
        if (token == null) {
            Column(
                modifier = Modifier.fillMaxSize().padding(24.dp),
                verticalArrangement = Arrangement.Center
            ) {
                Text("BigDaddy Games", style = MaterialTheme.typography.headlineMedium)
                Text("Native Android · Virtual demo mode", modifier = Modifier.padding(bottom = 24.dp))
                OutlinedTextField(
                    value = loginName, onValueChange = { loginName = it },
                    modifier = Modifier.fillMaxWidth(), label = { Text("Username") }, singleLine = true
                )
                OutlinedTextField(
                    value = password, onValueChange = { password = it },
                    modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                    label = { Text("Password") }, visualTransformation = PasswordVisualTransformation(),
                    singleLine = true
                )
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 12.dp)) }
                Button(
                    onClick = {
                        scope.launch {
                            busy = true
                            error = null
                            runCatching {
                                val result = api.login(loginName, password)
                                // Do not persist or expose a bearer token until the server confirms
                                // the session and the wallet endpoint is reachable.
                                val verifiedAccount = api.verifySession(result.token)
                                val verifiedBalance = api.walletBalance(result.token)
                                sessions.save(result.token)
                                token = result.token
                                username = verifiedAccount.username
                                role = verifiedAccount.role
                                balance = verifiedBalance
                                password = ""
                            }.onFailure { error = it.message ?: "Login failed." }
                            busy = false
                        }
                    },
                    enabled = !busy && loginName.isNotBlank() && password.isNotBlank(),
                    modifier = Modifier.fillMaxWidth().padding(top = 20.dp)
                ) { Text(if (busy) "Signing in…" else "Sign in") }
            }
        } else {
            Scaffold(
                bottomBar = {
                    NavigationBar {
                        listOf("Games").forEach { item ->
                            NavigationBarItem(
                                selected = tab == item,
                                onClick = { tab = item; selectedGame = null },
                                icon = {},
                                label = { Text(item) }
                            )
                        }
                    }
                }
            ) { padding ->
                Column(Modifier.fillMaxSize().padding(padding).padding(16.dp)) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("BigDaddy", style = MaterialTheme.typography.headlineSmall)
                        TextButton(onClick = { tab = "Profile"; selectedGame = null }) { Text("Profile") }
                    }
                    Spacer(Modifier.padding(4.dp))
                    when (tab) {
                        "Games" -> {
                            if (selectedGame == null) {
                                Text("Choose a local demo game", style = MaterialTheme.typography.titleMedium)
                                LazyColumn {
                                    items(gameNames) { (code, name) ->
                                        Card(Modifier.fillMaxWidth().padding(vertical = 5.dp)) {
                                            Row(Modifier.fillMaxWidth().padding(14.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                                                Text(name)
                                                TextButton(onClick = { selectedGame = code; lastResult = null }) { Text("Open") }
                                            }
                                        }
                                    }
                                }
                            } else {
                                val name = gameNames.first { it.first == selectedGame }.second
                                TextButton(onClick = { selectedGame = null; lastResult = null }) { Text("← All games") }
                                if (selectedGame == "aviator") {
                                    AviatorStatusScreen(
                                        round = aviatorState,
                                        loading = aviatorLoading,
                                        error = aviatorError
                                    )
                                } else {
                                    Text(name, style = MaterialTheme.typography.headlineSmall)
                                    Text("Local demo simulation only. No wallet payout is generated.")
                                    Button(
                                        onClick = {
                                            val started = System.currentTimeMillis()
                                            val outcome = engine.play(selectedGame!!)
                                            val ended = System.currentTimeMillis()
                                            lastResult = outcome.result
                                            scope.launch {
                                                historyDao.insert(
                                                    GameHistoryEntity(
                                                        id = UUID.randomUUID().toString(),
                                                        gameCode = outcome.gameCode,
                                                        roundId = outcome.roundId,
                                                        startedAtEpochMillis = started,
                                                        endedAtEpochMillis = ended,
                                                        demoResult = outcome.result
                                                    )
                                                )
                                            }
                                        },
                                        modifier = Modifier.fillMaxWidth().padding(top = 18.dp)
                                    ) { Text("Run demo round") }
                                    lastResult?.let { Text("Result: $it", modifier = Modifier.padding(top = 16.dp)) }
                                }
                            }
                        }
                        "Wallet" -> {
                            Text("Virtual wallet", style = MaterialTheme.typography.titleLarge)
                            Text("Balance: $balance")
                            Text("Balance is read from the secure backend. This native demo does not create credits or payouts.")
                            TextButton(onClick = {
                                scope.launch {
                                    runCatching { balance = api.walletBalance(token!!) }
                                        .onFailure { error = it.message }
                                }
                            }) { Text("Refresh balance") }
                            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                        }
                        "History" -> {
                            Text("Local game history", style = MaterialTheme.typography.titleLarge)
                            LazyColumn {
                                items(history) { item ->
                                    Card(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                                        Column(Modifier.padding(12.dp)) {
                                            Text(gameNames.firstOrNull { it.first == item.gameCode }?.second ?: item.gameCode)
                                            Text(item.demoResult)
                                            Text("Round ${item.roundId}", style = MaterialTheme.typography.labelSmall)
                                        }
                                    }
                                }
                            }
                        }
                        else -> {
                            Text("Player profile", style = MaterialTheme.typography.titleLarge)
                            Text("Username: $username")
                            Text("Role: $role")
                            Text("Game history is stored on this device.")
                            Text("Local game history", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 16.dp))
                            LazyColumn(modifier = Modifier.weight(1f)) {
                                items(history) { item ->
                                    Card(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                                        Column(Modifier.padding(12.dp)) {
                                            Text(gameNames.firstOrNull { it.first == item.gameCode }?.second ?: item.gameCode)
                                            Text(item.demoResult)
                                            Text("Round ${item.roundId}", style = MaterialTheme.typography.labelSmall)
                                        }
                                    }
                                }
                            }
                            TextButton(onClick = {
                                scope.launch {
                                    sessions.clear()
                                    token = null
                                    username = ""
                                    role = ""
                                    balance = "—"
                                    password = ""
                                }
                            }) { Text("Sign out") }
                        }
                    }
                }
            }
        }
    }
}


@Composable
private fun AviatorStatusScreen(
    round: AviatorRoundState?,
    loading: Boolean,
    error: String?
) {
    Column(Modifier.fillMaxWidth()) {
        Text("Aviator", style = MaterialTheme.typography.headlineSmall)
        Text("Live round status from BigDaddy server", style = MaterialTheme.typography.bodyMedium)
        if (loading && round == null) {
            Text("Connecting to live game…", modifier = Modifier.padding(top = 16.dp))
        }
        error?.let {
            Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 12.dp))
        }
        if (round == null) {
            Text(
                "No active round is currently available. This screen does not generate local crash results or change wallet balances.",
                modifier = Modifier.padding(top = 16.dp)
            )
        } else {
            Card(Modifier.fillMaxWidth().padding(top = 16.dp)) {
                Column(Modifier.padding(16.dp)) {
                    Text("Round #${round.roundNumber}", style = MaterialTheme.typography.titleMedium)
                    Text("Status: ${round.status}")
                    Text(
                        "${"%.2f".format(java.util.Locale.US, round.multiplier)}x",
                        style = MaterialTheme.typography.headlineLarge,
                        modifier = Modifier.padding(vertical = 12.dp)
                    )
                    if (round.status == "CRASHED" || round.status == "SETTLED") {
                        Text("Crash: ${round.crashMultiplier?.let { "%.2f".format(java.util.Locale.US, it) + "x" } ?: "Unavailable"}")
                    }
                    Text("Round ID: ${round.id}", style = MaterialTheme.typography.labelSmall)
                }
            }
        }
        Text(
            "Read-only integration: bets, cashout and wallet settlement are not enabled in this native screen.",
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.padding(top = 12.dp)
        )
    }
}
