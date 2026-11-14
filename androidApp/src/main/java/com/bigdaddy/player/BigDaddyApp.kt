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
    var accountId by remember { mutableStateOf("") }
    val history by historyDao.observeAll(accountId).collectAsState(initial = emptyList())
    val engine = remember { LocalDemoGameRegistry() }

    var token by remember { mutableStateOf<String?>(null) }
    var username by remember { mutableStateOf("") }
    var role by remember { mutableStateOf("") }
    var balance by remember { mutableStateOf("Unavailable") }
    var walletError by remember { mutableStateOf<String?>(null) }
    var loginName by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var tab by remember { mutableStateOf("Games") }
    var selectedGame by remember { mutableStateOf<String?>(null) }
    var lastResult by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        val saved = sessions.read()
        if (saved != null) {
            runCatching {
                val account = api.verifySession(saved)
                token = saved
                accountId = account.id
                username = account.username
                role = account.role
                balance = runCatching { api.walletBalance(saved) }.getOrElse {
                    walletError = "Wallet balance is temporarily unavailable."
                    "Unavailable"
                }
            }.onFailure { failure ->
                val message = failure.message.orEmpty()
                if (listOf("AUTH_REQUIRED", "INVALID_TOKEN", "USER_NOT_FOUND_OR_DISABLED", "TOKEN_ROLE_STALE")
                        .any { message.contains(it, ignoreCase = true) }) {
                    sessions.clear()
                    token = null
                    accountId = ""
                    username = ""
                    role = ""
                    balance = "Unavailable"
                    error = "Your session expired. Please sign in again."
                } else {
                    error = "Saved session could not be verified: $message"
                }
            }
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
                                // Authentication alone unlocks local demo games. Wallet reads are
                                // optional and must never block a valid player login.
                                val verifiedAccount = api.verifySession(result.token)
                                sessions.save(result.token)
                                token = result.token
                                accountId = verifiedAccount.id
                                username = verifiedAccount.username
                                role = verifiedAccount.role
                                balance = runCatching { api.walletBalance(result.token) }.getOrElse {
                                    walletError = "Wallet balance is temporarily unavailable."
                                    "Unavailable"
                                }
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
                                    NativeAviatorScreen(
                                        onRoundCompleted = { outcome, started, ended ->
                                            lastResult = outcome.result
                                            scope.launch {
                                                historyDao.insertAndPrune(
                                                    GameHistoryEntity(
                                                        id = UUID.randomUUID().toString(),
                                                        gameCode = outcome.gameCode,
                                                        roundId = outcome.roundId,
                                                        startedAtEpochMillis = started,
                                                        endedAtEpochMillis = ended,
                                                        demoResult = outcome.result,
                                                    playerAccountId = accountId
                                                    )
                                                )
                                            }
                                        }
                                    )
                                } else if (selectedGame == "dragon_tiger") {
                                    NativeDragonTigerScreen(
                                        onRoundCompleted = { outcome, started, ended ->
                                            lastResult = outcome.result
                                            scope.launch {
                                                historyDao.insertAndPrune(
                                                    GameHistoryEntity(
                                                        id = UUID.randomUUID().toString(),
                                                        gameCode = outcome.gameCode,
                                                        roundId = outcome.roundId,
                                                        startedAtEpochMillis = started,
                                                        endedAtEpochMillis = ended,
                                                        demoResult = outcome.result,
                                                    playerAccountId = accountId
                                                    )
                                                )
                                            }
                                        }
                                    )
                                } else if (selectedGame == "dice") {
                                    NativeLuckyTenScreen(
                                        onRoundCompleted = { outcome, started, ended ->
                                            lastResult = outcome.result
                                            scope.launch {
                                                historyDao.insertAndPrune(
                                                    GameHistoryEntity(
                                                        id = UUID.randomUUID().toString(),
                                                        gameCode = outcome.gameCode,
                                                        roundId = outcome.roundId,
                                                        startedAtEpochMillis = started,
                                                        endedAtEpochMillis = ended,
                                                        demoResult = outcome.result,
                                                    playerAccountId = accountId
                                                    )
                                                )
                                            }
                                        }
                                    )
                                } else if (selectedGame == "andar_bahar") {
                                    NativeAndarBaharScreen(
                                        onRoundCompleted = { outcome, started, ended ->
                                            lastResult = outcome.result
                                            scope.launch {
                                                historyDao.insertAndPrune(
                                                    GameHistoryEntity(
                                                        id = UUID.randomUUID().toString(),
                                                        gameCode = outcome.gameCode,
                                                        roundId = outcome.roundId,
                                                        startedAtEpochMillis = started,
                                                        endedAtEpochMillis = ended,
                                                        demoResult = outcome.result,
                                                    playerAccountId = accountId
                                                    )
                                                )
                                            }
                                        }
                                    )
                                } else if (selectedGame == "roulette") {
                                    NativeRouletteScreen(
                                        onRoundCompleted = { outcome, started, ended ->
                                            lastResult = outcome.result
                                            scope.launch {
                                                historyDao.insertAndPrune(
                                                    GameHistoryEntity(
                                                        id = UUID.randomUUID().toString(),
                                                        gameCode = outcome.gameCode,
                                                        roundId = outcome.roundId,
                                                        startedAtEpochMillis = started,
                                                        endedAtEpochMillis = ended,
                                                        demoResult = outcome.result,
                                                    playerAccountId = accountId
                                                    )
                                                )
                                            }
                                        }
                                    )
                                } else if (selectedGame == "teen_patti") {
                                    NativeTeenPattiScreen(
                                        onRoundCompleted = { outcome, started, ended ->
                                            lastResult = outcome.result
                                            scope.launch {
                                                historyDao.insertAndPrune(
                                                    GameHistoryEntity(
                                                        id = UUID.randomUUID().toString(),
                                                        gameCode = outcome.gameCode,
                                                        roundId = outcome.roundId,
                                                        startedAtEpochMillis = started,
                                                        endedAtEpochMillis = ended,
                                                        demoResult = outcome.result,
                                                    playerAccountId = accountId
                                                    )
                                                )
                                            }
                                        }
                                    )
                                } else {
                                    Text(name, style = MaterialTheme.typography.headlineSmall)
                                    Text("APK-local demo engine. No server game round or wallet payout is used.")
                                    Button(
                                        onClick = {
                                            val started = System.currentTimeMillis()
                                            val outcome = engine.play(selectedGame!!)
                                            val ended = System.currentTimeMillis()
                                            lastResult = outcome.result
                                            scope.launch {
                                                historyDao.insertAndPrune(
                                                    GameHistoryEntity(
                                                        id = UUID.randomUUID().toString(),
                                                        gameCode = outcome.gameCode,
                                                        roundId = outcome.roundId,
                                                        startedAtEpochMillis = started,
                                                        endedAtEpochMillis = ended,
                                                        demoResult = outcome.result,
                                                    playerAccountId = accountId
                                                    )
                                                )
                                            }
                                        },
                                        modifier = Modifier.fillMaxWidth().padding(top = 18.dp)
                                    ) { Text("Play local demo round") }
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
                                    walletError = null
                                    balance = runCatching { api.walletBalance(token!!) }.getOrElse {
                                        walletError = "Wallet balance could not be refreshed."
                                        "Unavailable"
                                    }
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
                            Card(Modifier.fillMaxWidth().padding(top = 12.dp)) {
                                Column(Modifier.padding(12.dp)) {
                                    Text("Wallet balance", style = MaterialTheme.typography.titleMedium)
                                    Text(balance, style = MaterialTheme.typography.headlineSmall)
                                    Text("Balance is read-only from the secure backend. Local demo rounds cannot change it.")
                                    TextButton(onClick = {
                                        scope.launch {
                                            walletError = null
                                            balance = runCatching { api.walletBalance(token!!) }.getOrElse {
                                                walletError = "Wallet balance could not be refreshed."
                                                "Unavailable"
                                            }
                                        }
                                    }) { Text("Refresh balance") }
                                    walletError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                                }
                            }
                            Text("Game history is stored privately on this device for this player account.")
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
                                    accountId = ""
                                    username = ""
                                    role = ""
                                    balance = "Unavailable"
                                    walletError = null
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

