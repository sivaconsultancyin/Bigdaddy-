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
import androidx.compose.material3.Surface
import androidx.compose.material3.darkColorScheme
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.bigdaddy.player.data.BigDaddyApi
import com.bigdaddy.player.data.NativeGameInfo
import com.bigdaddy.player.data.GameHistoryDatabase
import com.bigdaddy.player.data.GameHistoryEntity
import com.bigdaddy.player.data.SecureSessionStore
import com.bigdaddy.player.domain.LocalDemoGameRegistry
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.UUID

private val BigDaddyDarkColors = darkColorScheme(
    primary = Color(0xFFEF4444),
    onPrimary = Color.White,
    secondary = Color(0xFF22C55E),
    onSecondary = Color(0xFF07130B),
    background = Color(0xFF080B12),
    onBackground = Color(0xFFF8FAFC),
    surface = Color(0xFF111827),
    onSurface = Color(0xFFF8FAFC),
    surfaceVariant = Color(0xFF222943),
    onSurfaceVariant = Color(0xFFD4D8E6),
    surfaceTint = Color(0xFFFFC45C),
    surfaceContainerLowest = Color(0xFF080B14),
    surfaceContainerLow = Color(0xFF11182A),
    surfaceContainer = Color(0xFF171F34),
    surfaceContainerHigh = Color(0xFF202A43),
    surfaceContainerHighest = Color(0xFF2A3552),
    tertiary = Color(0xFFFFC45C),
    onTertiary = Color(0xFF171009),
    error = Color(0xFFF87171)
)

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
    var gameInventory by remember { mutableStateOf<List<NativeGameInfo>>(emptyList()) }

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

    LaunchedEffect(token) {
        val activeToken = token
        if (activeToken.isNullOrBlank()) {
            gameInventory = emptyList()
        } else {
            gameInventory = runCatching { api.gamesList(activeToken) }.getOrElse { emptyList() }
        }
    }

    MaterialTheme(colorScheme = BigDaddyDarkColors) {
        Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        if (token == null) {
            PremiumLoginPanel(
                loginName = loginName,
                onLoginNameChange = { loginName = it },
                password = password,
                onPasswordChange = { password = it },
                busy = busy,
                error = error,
                onSubmit = {
                    scope.launch {
                        busy = true
                        error = null
                        runCatching {
                            val result = api.login(loginName, password)
                            // Preserve the existing authentication/session contract.
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
                onReferralRegister = { referralUser, referralEmail, referralPassword, referralCode ->
                    api.registerReferral(referralUser, referralEmail, referralPassword, referralCode)
                    val loginResult = api.login(referralUser, referralPassword)
                    val verifiedAccount = api.verifySession(loginResult.token)
                    sessions.save(loginResult.token)
                    token = loginResult.token
                    accountId = verifiedAccount.id
                    username = verifiedAccount.username
                    role = verifiedAccount.role
                    balance = runCatching { api.walletBalance(loginResult.token) }.getOrElse {
                        walletError = "Wallet balance is temporarily unavailable."
                        "Unavailable"
                    }
                    loginName = referralUser
                    password = ""
                }
            )
        } else {
            Scaffold(
                containerColor = MaterialTheme.colorScheme.background,
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
                                PremiumGameLobby(
                                    onOpen = { code -> selectedGame = code; lastResult = null }
                                )
                            } else {
                                val name = gameNames.first { it.first == selectedGame }.second
                                TextButton(onClick = { selectedGame = null; lastResult = null }) { Text("← All games") }
                                if (selectedGame == "aviator") {
                                    PremiumGameHeader("AVIATOR", "Native visual demo · not connected to live rounds", Color(0xFFFF654F)) {}
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
                                } else {
                                    val preview = when (selectedGame) {
                                        "dragon_tiger" -> arrayOf(
                                            "DRAGON TIGER", "Classic fast-action card duel", "🐉", "Under Development",
                                            "Fast-Action Card Architecture",
                                            "Rapid 2-card showdown with Dragon, Tiger, or Tie selections. This native screen is a preview only; it does not deal cards or settle wagers."
                                        )
                                        "dice" -> arrayOf(
                                            "LUCKY 10 DICE", "Pick a number from 1 to 10", "🎲", "Engine Under Audit",
                                            "Provably Fair Architecture",
                                            "Lucky 10 number picks plus Small, Big, Even and Odd markets. Results must come from the authoritative server round."
                                        )
                                        "andar_bahar" -> arrayOf(
                                            "ANDAR BAHAR", "Traditional joker card matching", "🃏", "Under Development",
                                            "Classic Traditional Game",
                                            "Joker card matching with Andar (Inside) and Bahar (Outside) selections. Authoritative card sequence and settlement are not available in this native preview."
                                        )
                                        "roulette" -> arrayOf(
                                            "ROULETTE", "European single-zero wheel", "🎡", "Engine Under Audit",
                                            "European Roulette Architecture",
                                            "European Roulette will feature a single-zero wheel, inside and outside selections, and server-authoritative round settlement."
                                        )
                                        else -> arrayOf(
                                            "TEEN PATTI", "Three-card showdown", "♠", "Under Development",
                                            "Multiplayer Card Architecture",
                                            "Three-card game preview. Chaal, Blind and Showdown mechanics require authoritative table state and server settlement before native play is enabled."
                                        )
                                    }
                                    val serverGame = gameInventory.firstOrNull { it.code.replace('-', '_') == selectedGame }
                                    NativeComingSoonScreen(
                                        title = preview[0],
                                        subtitle = preview[1],
                                        symbol = preview[2],
                                        status = preview[3],
                                        architectureTitle = preview[4],
                                        description = preview[5],
                                        poolBalance = serverGame?.poolBalance?.takeIf { it.isNotBlank() }?.let {
                                            runCatching { java.math.BigInteger(it).toString() }.getOrDefault(it)
                                        } ?: "",
                                        minBet = serverGame?.minBet.orEmpty(),
                                        maxBet = serverGame?.maxBet.orEmpty(),
                                        onBack = { selectedGame = null; lastResult = null }
                                    )
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
}

