package com.bigdaddy.player

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.ui.window.Dialog
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.launch
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp

private data class PremiumGameStyle(
    val code: String,
    val title: String,
    val subtitle: String,
    val symbol: String,
    val accent: Color,
    val secondary: Color
)

private val premiumGames = listOf(
    PremiumGameStyle("aviator", "AVIATOR", "Native visual demo · live connection pending", "✈", Color(0xFFFF4D4D), Color(0xFFFF9B42)),
    PremiumGameStyle("dragon_tiger", "DRAGON TIGER", "Preview · Coming Soon", "🐉", Color(0xFFE34A4A), Color(0xFFFFC45C)),
    PremiumGameStyle("dice", "LUCKY 10 DICE", "Preview · Coming Soon", "🎲", Color(0xFF5C7CFA), Color(0xFFB56CFF)),
    PremiumGameStyle("andar_bahar", "ANDAR BAHAR", "Preview · Coming Soon", "🃏", Color(0xFF16A36A), Color(0xFFDBB65C)),
    PremiumGameStyle("roulette", "ROULETTE", "Preview · Coming Soon", "🎡", Color(0xFFDA3545), Color(0xFF171923)),
    PremiumGameStyle("teen_patti", "TEEN PATTI", "Preview · Coming Soon", "♠", Color(0xFF15966A), Color(0xFFFFC45C))
)

@Composable
private fun PremiumBackdrop(content: @Composable () -> Unit) {
    val transition = rememberInfiniteTransition(label = "premium-backdrop")
    val glow by transition.animateFloat(
        initialValue = 0.12f,
        targetValue = 0.32f,
        animationSpec = infiniteRepeatable(tween(3600), RepeatMode.Reverse),
        label = "ambient-glow"
    )
    Box(
        Modifier.fillMaxSize().background(
            Brush.linearGradient(
                colors = listOf(Color(0xFF050608), Color(0xFF09090B), Color(0xFF050608))
            )
        )
    ) {
        Box(
            Modifier.align(Alignment.TopEnd).size(280.dp)
                .graphicsLayer { alpha = glow }
                .background(
                    Brush.radialGradient(listOf(Color(0xFFF59E0B), Color.Transparent))
                )
        )
        Box(
            Modifier.align(Alignment.BottomStart).size(240.dp)
                .graphicsLayer { alpha = glow * 0.8f }
                .background(
                    Brush.radialGradient(listOf(Color(0xFFD97706), Color.Transparent))
                )
        )
        content()
    }
}

@Composable
fun PremiumLoginPanel(
    loginName: String,
    onLoginNameChange: (String) -> Unit,
    password: String,
    onPasswordChange: (String) -> Unit,
    busy: Boolean,
    error: String?,
    onSubmit: () -> Unit,
    onReferralRegister: suspend (String, String, String, String) -> Unit
) {
    var passwordVisible by remember { mutableStateOf(false) }
    var showReferralDialog by remember { mutableStateOf(false) }
    var referralUsername by remember { mutableStateOf("") }
    var referralEmail by remember { mutableStateOf("") }
    var referralPassword by remember { mutableStateOf("") }
    var referralCode by remember { mutableStateOf("BIGDADDY777") }
    var referralBusy by remember { mutableStateOf(false) }
    var referralError by remember { mutableStateOf<String?>(null) }
    val referralScope = rememberCoroutineScope()
    PremiumBackdrop {
        Column(
            Modifier.fillMaxSize().padding(horizontal = 26.dp, vertical = 28.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Box(
                Modifier.size(56.dp).clip(RoundedCornerShape(16.dp))
                    .background(Brush.linearGradient(listOf(Color(0xFFFBBF24), Color(0xFFD97706), Color(0xFFB45309))))
                    .border(1.dp, Color(0x66FDE68A), RoundedCornerShape(16.dp)),
                contentAlignment = Alignment.Center
            ) {
                Text("✦", color = Color(0xFF09090B), style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Black)
            }
            Spacer(Modifier.height(8.dp))
            Text("BigDaddy Games", color = Color(0xFFFBBF24), style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Black)
            Text("Mobile-first authoritative casino gaming platform", color = Color(0xFFA1A1AA), style = MaterialTheme.typography.labelSmall)
            Spacer(Modifier.height(30.dp))
            Card(
                Modifier.fillMaxWidth().border(1.dp, Color(0x4DF59E0B), RoundedCornerShape(16.dp)),
                colors = CardDefaults.cardColors(containerColor = Color(0xE617181B)),
                shape = RoundedCornerShape(12.dp)
            ) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedTextField(
                        value = loginName,
                        onValueChange = onLoginNameChange,
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        label = { Text("Username") },
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = Color(0xFFFFC45C),
                            unfocusedBorderColor = Color(0xFF565B70),
                            focusedTextColor = Color.White,
                            unfocusedTextColor = Color.White,
                            focusedLabelColor = Color(0xFFFFC45C),
                            unfocusedLabelColor = Color(0xFFB8BDCD),
                            cursorColor = Color(0xFFFFC45C)
                        )
                    )
                    OutlinedTextField(
                        value = password,
                        onValueChange = onPasswordChange,
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        label = { Text("Password") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                        visualTransformation = if (passwordVisible) VisualTransformation.None else PasswordVisualTransformation(),
                        trailingIcon = {
                            TextButton(onClick = { passwordVisible = !passwordVisible }) {
                                Text(if (passwordVisible) "HIDE" else "SHOW", color = Color(0xFFFFD27A))
                            }
                        },
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = Color(0xFFFFC45C),
                            unfocusedBorderColor = Color(0xFF565B70),
                            focusedTextColor = Color.White,
                            unfocusedTextColor = Color.White,
                            focusedLabelColor = Color(0xFFFFC45C),
                            unfocusedLabelColor = Color(0xFFB8BDCD),
                            cursorColor = Color(0xFFFFC45C)
                        )
                    )
                    if (error != null) Text(error, color = Color(0xFFFF7777), style = MaterialTheme.typography.bodySmall)
                    Button(
                        onClick = onSubmit,
                        enabled = !busy && loginName.isNotBlank() && password.isNotBlank(),
                        modifier = Modifier.fillMaxWidth().height(44.dp),
                        shape = RoundedCornerShape(16.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFF59E0B), contentColor = Color(0xFF09090B))
                    ) {
                        if (busy) CircularProgressIndicator(Modifier.size(20.dp), color = Color(0xFF100C08), strokeWidth = 2.dp)
                        else Text("Sign In", fontWeight = FontWeight.Bold)
                    }
                    Text("Secure player sign-in", color = Color(0xFF71717A), style = MaterialTheme.typography.labelSmall)
                    TextButton(
                        onClick = { referralError = null; showReferralDialog = true },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("✦  Have a referral code? Register", color = Color(0xFFFBBF24), style = MaterialTheme.typography.labelMedium)
                    }
                }
            }
        }
    }
    if (showReferralDialog) {
        Dialog(onDismissRequest = { if (!referralBusy) showReferralDialog = false }) {
            Card(
                Modifier.fillMaxWidth().border(1.dp, Color(0x66F59E0B), RoundedCornerShape(18.dp)),
                shape = RoundedCornerShape(18.dp),
                colors = CardDefaults.cardColors(containerColor = Color(0xFF09090B))
            ) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Referral Registration", color = Color(0xFFFCDFA0), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    Text("Registration requires a sponsor code. New accounts are registered as Players.", color = Color(0xFFA1A1AA), style = MaterialTheme.typography.bodySmall)
                    OutlinedTextField(value = referralCode, onValueChange = { referralCode = it.uppercase() }, modifier = Modifier.fillMaxWidth(), singleLine = true, label = { Text("Referral Code") })
                    OutlinedTextField(value = referralUsername, onValueChange = { referralUsername = it }, modifier = Modifier.fillMaxWidth(), singleLine = true, label = { Text("Username") })
                    OutlinedTextField(value = referralEmail, onValueChange = { referralEmail = it }, modifier = Modifier.fillMaxWidth(), singleLine = true, label = { Text("Email") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
                    OutlinedTextField(value = referralPassword, onValueChange = { referralPassword = it }, modifier = Modifier.fillMaxWidth(), singleLine = true, label = { Text("Password") }, visualTransformation = PasswordVisualTransformation())
                    referralError?.let { Text(it, color = Color(0xFFFF7777), style = MaterialTheme.typography.bodySmall) }
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
                        TextButton(onClick = { showReferralDialog = false }, enabled = !referralBusy) { Text("Cancel", color = Color(0xFFA1A1AA)) }
                        Button(
                            enabled = !referralBusy && referralCode.isNotBlank() && referralUsername.isNotBlank() && referralEmail.isNotBlank() && referralPassword.length >= 6,
                            onClick = {
                                referralScope.launch {
                                    referralBusy = true
                                    referralError = null
                                    runCatching {
                                        onReferralRegister(referralUsername, referralEmail, referralPassword, referralCode)
                                    }.onSuccess {
                                        showReferralDialog = false
                                        referralUsername = ""
                                        referralEmail = ""
                                        referralPassword = ""
                                    }.onFailure {
                                        referralError = it.message ?: "Registration failed. Please try again."
                                    }
                                    referralBusy = false
                                }
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFF59E0B), contentColor = Color(0xFF09090B))
                        ) {
                            if (referralBusy) CircularProgressIndicator(Modifier.size(16.dp), color = Color(0xFF09090B), strokeWidth = 2.dp)
                            else Text("Register", fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun PremiumGameLobby(
    onOpen: (String) -> Unit,
    showSummary: Boolean = false,
    username: String = "",
    balance: String = "Unavailable",
    onWalletClick: () -> Unit = {},
    onProfileClick: () -> Unit = {}
) {
    Column(Modifier.fillMaxSize()) {
        Text(
            "CASINO GAMES",
            color = Color(0xFFFDE68A),
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.Black
        )
        Text(
            "Choose your game",
            color = Color(0xFFF4F4F5),
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Black
        )
        Spacer(Modifier.height(10.dp))
        LazyVerticalGrid(
            columns = GridCells.Fixed(2),
            modifier = if (showSummary) Modifier.height(300.dp) else Modifier.weight(1f),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            items(premiumGames) { game ->
                val entrance by animateFloatAsState(
                    targetValue = 1f,
                    animationSpec = tween(durationMillis = 420),
                    label = "game-card-entrance-${game.code}"
                )
                Card(
                    Modifier
                        .fillMaxWidth()
                        .height(126.dp)
                        .graphicsLayer {
                            alpha = entrance
                            translationY = (1f - entrance) * 14f
                        }
                        .border(1.dp, Color(0xFF3F3F46), RoundedCornerShape(12.dp))
                        .clickable { onOpen(game.code) },
                    shape = RoundedCornerShape(12.dp),
                    colors = CardDefaults.cardColors(containerColor = Color(0xFF18181B))
                ) {
                    Column(
                        Modifier
                            .fillMaxSize()
                            .background(
                                Brush.linearGradient(
                                    listOf(
                                        game.accent.copy(alpha = 0.16f),
                                        Color(0xFF18181B),
                                        Color(0xFF09090B)
                                    )
                                )
                            )
                            .padding(10.dp),
                        verticalArrangement = Arrangement.SpaceBetween
                    ) {
                        Row(
                            Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Box(
                                Modifier
                                    .size(30.dp)
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(
                                        if (game.code == "aviator") {
                                            Brush.linearGradient(
                                                listOf(Color(0xFFDC2626), Color(0xFFF59E0B))
                                            )
                                        } else {
                                            Brush.linearGradient(
                                                listOf(Color(0xFF27272A), Color(0xFF3F3F46))
                                            )
                                        }
                                    ),
                                contentAlignment = Alignment.Center
                            ) {
                                Text(
                                    game.symbol,
                                    style = MaterialTheme.typography.titleMedium,
                                    color = Color.White
                                )
                            }
                            Text(
                                if (game.code == "aviator") "DEMO" else "PREVIEW",
                                color = if (game.code == "aviator") Color(0xFFFBBF24) else Color(0xFFA1A1AA),
                                style = MaterialTheme.typography.labelSmall,
                                fontWeight = FontWeight.Bold
                            )
                        }
                        Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                            Text(
                                game.title,
                                color = Color(0xFFE4E4E7),
                                style = MaterialTheme.typography.labelLarge,
                                fontWeight = FontWeight.Bold,
                                maxLines = 1
                            )
                            Row(
                                Modifier
                                    .fillMaxWidth()
                                    .background(Color(0xFF27272A), RoundedCornerShape(5.dp))
                                    .padding(horizontal = 7.dp, vertical = 4.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    "Game",
                                    color = Color(0xFF71717A),
                                    style = MaterialTheme.typography.labelSmall
                                )
                                Text(
                                    "Play ›",
                                    color = Color(0xFFFBBF24),
                                    style = MaterialTheme.typography.labelSmall,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                        }
                    }
                }
            }
        }
        if (showSummary) {
            Card(
                Modifier.fillMaxWidth().padding(top = 10.dp).clickable(onClick = onWalletClick),
                colors = CardDefaults.cardColors(containerColor = Color(0xFF09090B)),
                shape = RoundedCornerShape(14.dp)
            ) {
                Row(Modifier.fillMaxWidth().padding(14.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text("MY WALLET", color = Color(0xFFFCDFA0), style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
                        Text("Available balance · read-only", color = Color(0xFF71717A), style = MaterialTheme.typography.labelSmall)
                    }
                    Text(balance, color = Color(0xFFFBBF24), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Black)
                }
            }
            Card(
                Modifier.fillMaxWidth().padding(top = 8.dp).clickable(onClick = onProfileClick),
                colors = CardDefaults.cardColors(containerColor = Color(0xFF09090B)),
                shape = RoundedCornerShape(14.dp)
            ) {
                Row(Modifier.fillMaxWidth().padding(14.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text("PLAYER PROFILE", color = Color(0xFFFCDFA0), style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
                        Text(username.ifBlank { "Player account" }, color = Color(0xFFA1A1AA), style = MaterialTheme.typography.bodySmall)
                    }
                    Text("View ›", color = Color(0xFFFBBF24), style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@Composable
fun PremiumGameHeader(title: String, subtitle: String, accent: Color, content: @Composable () -> Unit) {
    val transition = rememberInfiniteTransition(label = "game-header-glow")
    val glow by transition.animateFloat(
        initialValue = 0.35f,
        targetValue = 0.95f,
        animationSpec = infiniteRepeatable(tween(1800), RepeatMode.Reverse),
        label = "game-header-border"
    )
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Card(
            Modifier.fillMaxWidth().border(1.dp, accent.copy(alpha = glow), RoundedCornerShape(22.dp)),
            colors = CardDefaults.cardColors(containerColor = Color(0xFF151827)),
            shape = RoundedCornerShape(22.dp)
        ) {
            Column(
                Modifier.fillMaxWidth().background(Brush.horizontalGradient(listOf(accent.copy(alpha = 0.28f), Color(0xFF151827), Color(0xFF17152A))))
                    .padding(18.dp)
            ) {
                Text(title.uppercase(), color = Color.White, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold)
                Text(subtitle, color = accent, style = MaterialTheme.typography.bodySmall)
            }
        }
        content()
    }
}


@Composable
fun PremiumDashboardFilters(selected: String, onSelect: (String) -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp))
            .background(Color(0xFF18181B)).padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        listOf("All", "Games", "Wallet", "Profile").forEach { label ->
            val active = selected == label
            Box(
                Modifier.weight(1f).clip(RoundedCornerShape(10.dp))
                    .background(if (active) Color(0xFFF59E0B) else Color.Transparent)
                    .clickable { onSelect(label) }.padding(vertical = 8.dp),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    label,
                    color = if (active) Color(0xFF09090B) else Color(0xFFA1A1AA),
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.Bold
                )
            }
        }
    }
}
