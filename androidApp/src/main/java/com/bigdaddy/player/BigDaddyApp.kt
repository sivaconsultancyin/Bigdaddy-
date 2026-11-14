package com.bigdaddy.player

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
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
import com.bigdaddy.player.data.GameHistoryDatabase
import com.bigdaddy.player.data.GameHistoryEntity
import com.bigdaddy.player.data.SecureSessionStore
import com.bigdaddy.player.domain.LocalDemoGameRegistry
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.UUID

private val BigDaddyDarkColors = darkColorScheme(
    primary = Color(0xFFF59E0B),
    onPrimary = Color(0xFF09090B),
    secondary = Color(0xFFD97706),
    onSecondary = Color(0xFF09090B),
    background = Color(0xFF050608),
    onBackground = Color(0xFFF4F4F5),
    surface = Color(0xFF09090B),
    onSurface = Color(0xFFF4F4F5),
    surfaceVariant = Color(0xFF18181B),
    onSurfaceVariant = Color(0xFFA1A1AA),
    surfaceTint = Color(0xFFF59E0B),
    surfaceContainerLowest = Color(0xFF050608),
    surfaceContainerLow = Color(0xFF09090B),
    surfaceContainer = Color(0xFF18181B),
    surfaceContainerHigh = Color(0xFF27272A),
    surfaceContainerHighest = Color(0xFF3F3F46),
    tertiary = Color(0xFFFFC45C),
    onTertiary = Color(0xFF09090B),
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
    var tab by remember { mutableStateOf("All") }
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
            Scaffold(containerColor = MaterialTheme.colorScheme.background) { padding ->
                Column(Modifier.fillMaxSize().padding(padding).padding(horizontal = 12.dp, vertical = 10.dp).then(if (tab == "Profile") Modifier else Modifier.verticalScroll(rememberScrollState()))) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("BigDaddy Games", color = Color(0xFFFCDFA0), style = MaterialTheme.typography.titleLarge,
                            fontWeight = androidx.compose.ui.text.font.FontWeight.Black)
                    }
                    PremiumDashboardFilters(
                        selected = tab,
                        onSelect = { selected -> tab = selected; selectedGame = null }
                    )
                    Spacer(Modifier.padding(3.dp))
                    when (tab) {
                        "All", "Games" -> {
                            if (selectedGame == null) {
                                PremiumGameLobby(
                                    onOpen = { code -> selectedGame = code; lastResult = null },
                                    showSummary = tab == "All",
                                    username = username,
                                    balance = balance,
                                    onWalletClick = { tab = "Wallet" },
                                    onProfileClick = { tab = "Profile" }
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
                                    NativeComingSoonScreen(
                                        title = preview[0],
                                        subtitle = preview[1],
                                        symbol = preview[2],
                                        status = preview[3],
                                        architectureTitle = preview[4],
                                        description = preview[5],
                                        poolBalance = "",
                                        minBet = "",
                                        maxBet = "",
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
                            Text("PLAYER PROFILE", color = Color(0xFFFCDFA0), style = MaterialTheme.typography.labelLarge, fontWeight = androidx.compose.ui.text.font.FontWeight.Black)
                            Card(
                                Modifier.fillMaxWidth().padding(top = 8.dp),
                                colors = androidx.compose.material3.CardDefaults.cardColors(containerColor = Color(0xFF09090B))
                            ) {
                                Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                        Text("My Profile", color = Color(0xFFFCDFA0), style = MaterialTheme.typography.titleLarge, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold)
                                        Text("VERIFIED", color = Color(0xFF86EFAC), style = MaterialTheme.typography.labelSmall,
                                            modifier = Modifier.background(Color(0x1A22C55E), androidx.compose.foundation.shape.RoundedCornerShape(20.dp)).padding(horizontal = 9.dp, vertical = 5.dp))
                                    }
                                    ProfileInfoRow("Username", username)
                                    ProfileInfoRow("Account Role", role)
                                    ProfileInfoRow("Session Status", "Signed in")
                                }
                            }
                            Card(
                                Modifier.fillMaxWidth().padding(top = 10.dp),
                                colors = androidx.compose.material3.CardDefaults.cardColors(containerColor = Color(0xFF09090B))
                            ) {
                                Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Text("Wallet Balance", color = Color(0xFFFCDFA0), style = MaterialTheme.typography.titleMedium)
                                    Text(balance, color = Color(0xFFFBBF24), style = MaterialTheme.typography.headlineMedium)
                                    Text("Read-only balance from the secure backend. Native visual demos cannot debit or credit this wallet.",
                                        color = Color(0xFFA1A1AA), style = MaterialTheme.typography.bodySmall)
                                    TextButton(onClick = {
                                        scope.launch {
                                            walletError = null
                                            balance = runCatching { api.walletBalance(token!!) }.getOrElse {
                                                walletError = "Wallet balance could not be refreshed."
                                                "Unavailable"
                                            }
                                        }
                                    }) { Text("Refresh balance", color = Color(0xFFFBBF24)) }
                                    walletError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                                }
                            }
                            Text("Local game history", color = Color(0xFFFCDFA0), style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 14.dp))
                            Text("Stored privately on this device for this player account.", color = Color(0xFF71717A), style = MaterialTheme.typography.bodySmall)
                            LazyColumn(modifier = Modifier.weight(1f)) {
                                items(history) { item ->
                                    Card(Modifier.fillMaxWidth().padding(vertical = 4.dp),
                                        colors = androidx.compose.material3.CardDefaults.cardColors(containerColor = Color(0xFF18181B))) {
                                        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                            Text(gameNames.firstOrNull { it.first == item.gameCode }?.second ?: item.gameCode, color = Color(0xFFE4E4E7))
                                            Text(item.demoResult, color = Color(0xFFFBBF24))
                                            Text("Round \${item.roundId}", color = Color(0xFF71717A), style = MaterialTheme.typography.labelSmall)
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
                            }) { Text("Sign out", color = Color(0xFFFCA5A5)) }
                        }
                    }
                }
            }
        }
        }
    }
}


@Composable
private fun ProfileInfoRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth().background(Color(0xFF18181B), androidx.compose.foundation.shape.RoundedCornerShape(10.dp)).padding(horizontal = 12.dp, vertical = 10.dp), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = Color(0xFFA1A1AA), style = MaterialTheme.typography.bodySmall)
        Text(value.ifBlank { "—" }, color = Color(0xFFF4F4F5), style = MaterialTheme.typography.bodySmall, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold)
    }
}
