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
import androidx.compose.foundation.lazy.items
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
    PremiumGameStyle("aviator", "AVIATOR", "Take flight · Multiplier demo", "✈", Color(0xFFFF4D4D), Color(0xFFFF9B42)),
    PremiumGameStyle("dragon_tiger", "DRAGON TIGER", "Classic card duel", "🐉", Color(0xFFE34A4A), Color(0xFFFFC45C)),
    PremiumGameStyle("dice", "LUCKY 10 DICE", "Roll the winning number", "🎲", Color(0xFF5C7CFA), Color(0xFFB56CFF)),
    PremiumGameStyle("andar_bahar", "ANDAR BAHAR", "Traditional card table", "🃏", Color(0xFF16A36A), Color(0xFFDBB65C)),
    PremiumGameStyle("roulette", "ROULETTE", "European single-zero wheel", "🎡", Color(0xFFDA3545), Color(0xFF171923)),
    PremiumGameStyle("teen_patti", "TEEN PATTI", "Three-card showdown", "♠", Color(0xFF15966A), Color(0xFFFFC45C))
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
                colors = listOf(Color(0xFF050711), Color(0xFF111329), Color(0xFF080B14))
            )
        )
    ) {
        Box(
            Modifier.align(Alignment.TopEnd).size(280.dp)
                .graphicsLayer { alpha = glow }
                .background(
                    Brush.radialGradient(listOf(Color(0xFF7438C8), Color.Transparent))
                )
        )
        Box(
            Modifier.align(Alignment.BottomStart).size(240.dp)
                .graphicsLayer { alpha = glow * 0.8f }
                .background(
                    Brush.radialGradient(listOf(Color(0xFFB77A2C), Color.Transparent))
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
    onSubmit: () -> Unit
) {
    var passwordVisible by remember { mutableStateOf(false) }
    PremiumBackdrop {
        Column(
            Modifier.fillMaxSize().padding(horizontal = 26.dp, vertical = 28.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text("BIG", color = Color(0xFFFFD27A), style = MaterialTheme.typography.displayMedium, fontWeight = FontWeight.Black)
            Text("DADDY", color = Color.White, style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.ExtraBold)
            Text("PREMIUM GAME LOUNGE", color = Color(0xFFC5A7F2), style = MaterialTheme.typography.labelLarge)
            Spacer(Modifier.height(30.dp))
            Card(
                Modifier.fillMaxWidth().border(1.dp, Color(0xFF72549B), RoundedCornerShape(26.dp)),
                colors = CardDefaults.cardColors(containerColor = Color(0xE6151929)),
                shape = RoundedCornerShape(26.dp)
            ) {
                Column(Modifier.padding(22.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Text("WELCOME BACK", color = Color(0xFFFFD27A), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    Text("Sign in to enter the lounge", color = Color(0xFFD7D9E5), style = MaterialTheme.typography.bodyMedium)
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
                        modifier = Modifier.fillMaxWidth().height(54.dp),
                        shape = RoundedCornerShape(16.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFB77A2C), contentColor = Color(0xFF100C08))
                    ) {
                        if (busy) CircularProgressIndicator(Modifier.size(20.dp), color = Color(0xFF100C08), strokeWidth = 2.dp)
                        else Text("ENTER GAME LOUNGE", fontWeight = FontWeight.ExtraBold)
                    }
                    Text("Secure player sign-in · Native Android", color = Color(0xFF9CA3B8), style = MaterialTheme.typography.labelSmall)
                }
            }
        }
    }
}

@Composable
fun PremiumGameLobby(onOpen: (String) -> Unit) {
    Column(Modifier.fillMaxSize()) {
        Text("THE GAME LOUNGE", color = Color(0xFFFFD27A), style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
        Text("Choose your game", color = Color.White, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.ExtraBold)
        Text("Six native experiences · Virtual demo mode", color = Color(0xFFAEB4C7), style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(16.dp))
        androidx.compose.foundation.lazy.LazyColumn(
            verticalArrangement = Arrangement.spacedBy(13.dp)
        ) {
            items(premiumGames.size) { index ->
                val game = premiumGames[index]
                val entrance by animateFloatAsState(
                    targetValue = 1f,
                    animationSpec = tween(durationMillis = 520, delayMillis = index * 65),
                    label = "game-card-entrance-$index"
                )
                Card(
                    Modifier.fillMaxWidth().height(112.dp)
                        .graphicsLayer { alpha = entrance; translationY = (1f - entrance) * 22f }
                        .clickable { onOpen(game.code) },
                    shape = RoundedCornerShape(22.dp),
                    colors = CardDefaults.cardColors(containerColor = Color(0xFF151827))
                ) {
                    Row(
                        Modifier.fillMaxSize().background(
                            Brush.linearGradient(listOf(game.accent.copy(alpha = 0.30f), Color(0xFF171A2A), game.secondary.copy(alpha = 0.18f)))
                        ).padding(horizontal = 18.dp, vertical = 14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        Box(
                            Modifier.size(68.dp).clip(RoundedCornerShape(20.dp))
                                .background(Brush.linearGradient(listOf(game.accent, game.secondary))),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(game.symbol, style = MaterialTheme.typography.headlineLarge, color = Color.White)
                        }
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.Center) {
                            Text(game.title, color = Color.White, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.ExtraBold)
                            Text(game.subtitle, color = Color(0xFFB8BED0), style = MaterialTheme.typography.bodySmall)
                        }
                        Text("›", color = game.secondary, style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold)
                    }
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
