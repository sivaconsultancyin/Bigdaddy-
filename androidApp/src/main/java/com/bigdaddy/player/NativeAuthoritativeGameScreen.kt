package com.bigdaddy.player

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.font.FontWeight
import com.bigdaddy.player.data.BigDaddyApi
import com.bigdaddy.player.data.NativeAuthoritativeGameState
import com.bigdaddy.player.data.NativeGameCard
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlin.math.min

private val rouletteWheelOrder = listOf(
    0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
    5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26
)
private val rouletteRedNumbers = setOf(1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36)

@Composable
internal fun NativeAuthoritativeGameScreen(
    api: BigDaddyApi,
    token: String,
    gameCode: String
) {
    var state by remember(gameCode) { mutableStateOf<NativeAuthoritativeGameState?>(null) }
    var error by remember(gameCode) { mutableStateOf<String?>(null) }
    var loading by remember(gameCode) { mutableStateOf(true) }
    var refreshKey by remember(gameCode) { mutableStateOf(0) }

    LaunchedEffect(token, gameCode, refreshKey) {
        var retryDelay = 1_000L
        while (true) {
            try {
                state = api.authoritativeGameState(token, gameCode)
                error = null
                loading = false
                retryDelay = 1_000L
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                error = failure.message?.take(180) ?: "Game state is temporarily unavailable."
                loading = false
                retryDelay = (retryDelay * 2L).coerceAtMost(5_000L)
            }
            delay(retryDelay)
        }
    }

    val status = state?.roundStatus ?: if (loading) "CONNECTING" else "OFFLINE"
    val isAnimating = status in setOf("SPINNING", "ROLLING", "DEALING")
    val isResult = status == "RESULT" || status == "SETTLED"
    val transition = rememberInfiniteTransition(label = "authoritative-game-motion")
    val wheelRotation by transition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(tween(2_400, easing = LinearEasing)),
        label = "roulette-wheel"
    )
    val diceRotation by transition.animateFloat(
        initialValue = -9f,
        targetValue = 9f,
        animationSpec = infiniteRepeatable(tween(360), RepeatMode.Reverse),
        label = "dice-roll"
    )
    val cardPulse by transition.animateFloat(
        initialValue = 0.96f,
        targetValue = 1.04f,
        animationSpec = infiniteRepeatable(tween(620), RepeatMode.Reverse),
        label = "card-deal"
    )

    Column(verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text(
                when (status) {
                    "BETTING" -> "BETTING OPEN"
                    "SPINNING" -> "WHEEL SPINNING"
                    "ROLLING" -> "DICE ROLLING"
                    "DEALING" -> "DEALING CARDS"
                    "RESULT", "SETTLED" -> "ROUND RESULT"
                    "COMING_SOON" -> "CURRENTLY UNAVAILABLE"
                    "OFFLINE" -> "SERVER OFFLINE"
                    else -> "CONNECTING TO SERVER"
                },
                color = when (status) {
                    "RESULT", "SETTLED" -> Color(0xFF86EFAC)
                    "OFFLINE" -> Color(0xFFFCA5A5)
                    "COMING_SOON" -> Color(0xFFFBBF24)
                    else -> Color(0xFFFCDFA0)
                },
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.Black
            )
            TextButton(onClick = { refreshKey++ }) {
                Text("Refresh", color = Color(0xFFFBBF24), fontSize = 11.sp)
            }
        }

        Card(
            Modifier.fillMaxWidth().border(1.dp, Color(0x55F59E0B), RoundedCornerShape(18.dp)),
            shape = RoundedCornerShape(18.dp),
            colors = CardDefaults.cardColors(containerColor = Color(0xFF09090B)),
            elevation = CardDefaults.cardElevation(defaultElevation = 10.dp)
        ) {
            Column(
                Modifier.fillMaxWidth()
                    .background(Brush.linearGradient(listOf(Color(0xFF21170A), Color(0xFF09090B), Color(0xFF111113))))
                    .padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                when (gameCode) {
                    "roulette" -> RouletteRoundVisual(state, isAnimating, wheelRotation)
                    "dice" -> DiceRoundVisual(state, isAnimating, diceRotation)
                    "andar_bahar" -> AndarBaharRoundVisual(state, isAnimating, cardPulse)
                }
                if (state?.roundId == null && status == "COMING_SOON") {
                    Text(
                        "No active authoritative round is available. The app will not create a local result.",
                        color = Color(0xFFA1A1AA),
                        style = MaterialTheme.typography.bodySmall
                    )
                }
                state?.let { current ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        GameMetric("ROUND", current.roundNumber.takeIf { it > 0 }?.toString() ?: "—", Modifier.weight(1f))
                        GameMetric("BETS", current.totalBetsCount.toString(), Modifier.weight(1f))
                        GameMetric("TOTAL", current.totalBetAmount, Modifier.weight(1f))
                    }
                }
                if (loading) {
                    Text("Reading the authoritative game server…", color = Color(0xFFA1A1AA), style = MaterialTheme.typography.bodySmall)
                }
                error?.let {
                    Text("State unavailable: $it", color = Color(0xFFFCA5A5), style = MaterialTheme.typography.bodySmall)
                }
            }
        }

        state?.history?.take(6)?.takeIf { it.isNotEmpty() }?.let { history ->
            Card(
                Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = Color(0xFF09090B)),
                shape = RoundedCornerShape(14.dp)
            ) {
                Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                    Text("SERVER-SETTLED HISTORY", color = Color(0xFFFCDFA0), fontWeight = FontWeight.Black, fontSize = 11.sp)
                    history.forEach { item ->
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text("#${item.roundNumber}", color = Color(0xFF71717A), fontSize = 11.sp)
                            Text(item.summary, color = Color(0xFFE4E4E7), fontSize = 11.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        }

        Text(
            "READ ONLY · Round state and results come from the Node.js server. Betting and wallet actions are not enabled in this native screen.",
            color = Color(0xFF71717A),
            style = MaterialTheme.typography.bodySmall
        )
    }
}

@Composable
private fun RouletteRoundVisual(state: NativeAuthoritativeGameState?, spinning: Boolean, rotation: Float) {
    Box(
        Modifier.fillMaxWidth().height(228.dp)
            .background(Color(0xFF070A08), RoundedCornerShape(14.dp)),
        contentAlignment = Alignment.Center
    ) {
        Canvas(
            Modifier.size(210.dp).graphicsLayer { rotationZ = if (spinning) rotation else 0f }
        ) {
            val diameter = min(size.width, size.height) * 0.94f
            val radius = diameter / 2f
            val topLeft = Offset((size.width - diameter) / 2f, (size.height - diameter) / 2f)
            val wheelSize = Size(diameter, diameter)
            val sweep = 360f / rouletteWheelOrder.size
            rouletteWheelOrder.forEachIndexed { index, number ->
                val segmentColor = when {
                    number == 0 -> Color(0xFF159447)
                    number in rouletteRedNumbers -> Color(0xFFB91C32)
                    else -> Color(0xFF18181B)
                }
                drawArc(
                    color = segmentColor,
                    startAngle = -90f + index * sweep,
                    sweepAngle = sweep + 0.35f,
                    useCenter = true,
                    topLeft = topLeft,
                    size = wheelSize
                )
            }
            drawCircle(Color(0xFFD6B66D), radius = radius * 0.56f, style = Stroke(width = 4.dp.toPx()))
            drawCircle(Color(0xFF111827), radius = radius * 0.52f)
            drawCircle(Color(0xFFD6B66D), radius = radius * 0.12f)
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text("EUROPEAN", color = Color(0xFFE5D3A2), fontSize = 9.sp, fontWeight = FontWeight.Bold)
            Text("ROULETTE", color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.Black)
            if (!spinning && state?.winningNumber != null) {
                Text(
                    "${state.winningNumber}  ${state.rouletteColor?.uppercase().orEmpty()}",
                    color = when (state.rouletteColor) {
                        "red" -> Color(0xFFFF7777)
                        "black" -> Color.White
                        else -> Color(0xFF86EFAC)
                    },
                    fontSize = 19.sp,
                    fontWeight = FontWeight.Black
                )
            } else {
                Text(if (spinning) "SPINNING" else "WAITING", color = Color(0xFFFCDFA0), fontSize = 10.sp)
            }
        }
        Text("▼", Modifier.align(Alignment.TopCenter).padding(top = 3.dp), color = Color(0xFFFFD27A), fontSize = 20.sp)
    }
}

@Composable
private fun DiceRoundVisual(state: NativeAuthoritativeGameState?, rolling: Boolean, rotation: Float) {
    Box(
        Modifier.fillMaxWidth().height(220.dp)
            .background(Color(0xFF090A13), RoundedCornerShape(14.dp)),
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(
                Modifier.size(126.dp)
                    .graphicsLayer { rotationZ = if (rolling) rotation else 0f }
                    .clip(RoundedCornerShape(24.dp))
                    .background(Brush.linearGradient(listOf(Color(0xFF8EA0FF), Color(0xFF5559B8))))
                    .border(2.dp, Color(0xFFBAC4FF), RoundedCornerShape(24.dp)),
                contentAlignment = Alignment.Center
            ) {
                Text("⚄", color = Color.White, fontSize = 72.sp, fontWeight = FontWeight.Black)
            }
            Text(
                when {
                    rolling -> "ROLLING"
                    state?.diceNumber != null -> "SERVER RESULT · ${state.diceNumber}"
                    else -> "LUCKY 10"
                },
                color = Color(0xFFDCE1FF),
                fontWeight = FontWeight.Black,
                fontSize = 14.sp
            )
        }
    }
}

@Composable
private fun AndarBaharRoundVisual(state: NativeAuthoritativeGameState?, dealing: Boolean, pulse: Float) {
    Column(
        Modifier.fillMaxWidth().background(Color(0xFF07130F), RoundedCornerShape(14.dp)).padding(12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Text("ANDAR  /  BAHAR", color = Color(0xFFBCEBD3), fontSize = 13.sp, fontWeight = FontWeight.Black)
        if (state?.jokerCard == null) {
            Row(horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                repeat(3) { index ->
                    CardBack(Modifier.graphicsLayer {
                        rotationY = if (dealing) 16f * pulse * (if (index % 2 == 0) 1f else -1f) else 0f
                    })
                }
            }
            Text(
                if (dealing) "SERVER IS DEALING" else "WAITING FOR SERVER DEAL",
                color = Color(0xFFBCEBD3),
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold
            )
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("JOKER", color = Color(0xFFA1A1AA), fontSize = 9.sp, fontWeight = FontWeight.Bold)
                    NativeCardFace(state.jokerCard)
                }
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("WINNING CARD", color = Color(0xFFA1A1AA), fontSize = 9.sp, fontWeight = FontWeight.Bold)
                    NativeCardFace(state.winningCard)
                }
            }
            Text(
                "SERVER RESULT · ${state.winningSide?.uppercase().orEmpty()}",
                color = Color(0xFF86EFAC),
                fontSize = 13.sp,
                fontWeight = FontWeight.Black
            )
            Text("${state.dealCards.size} cards dealt", color = Color(0xFFA1A1AA), fontSize = 10.sp)
            LazyRow(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                contentPadding = PaddingValues(horizontal = 2.dp)
            ) {
                items(state.dealCards.takeLast(8)) { card ->
                    NativeCardFace(card, compact = true)
                }
            }
        }
    }
}

@Composable
private fun CardBack(modifier: Modifier = Modifier) {
    Box(
        modifier.size(62.dp, 88.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(Brush.linearGradient(listOf(Color(0xFF0F766E), Color(0xFF064E3B))))
            .border(2.dp, Color(0xFFD6B66D), RoundedCornerShape(8.dp)),
        contentAlignment = Alignment.Center
    ) {
        Text("✦", color = Color(0xFFFFD27A), fontSize = 30.sp)
    }
}

@Composable
private fun NativeCardFace(card: NativeGameCard?, compact: Boolean = false) {
    val red = card?.suit in setOf("H", "D")
    Box(
        Modifier.size(if (compact) 42.dp else 62.dp, if (compact) 58.dp else 88.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(Color(0xFFF4F1E8))
            .border(1.dp, Color(0xFFD6B66D), RoundedCornerShape(8.dp)),
        contentAlignment = Alignment.Center
    ) {
        Text(
            card?.code ?: "—",
            color = if (red) Color(0xFFB91C32) else Color(0xFF18181B),
            fontSize = if (compact) 10.sp else 17.sp,
            fontWeight = FontWeight.Black
        )
    }
}

@Composable
private fun GameMetric(label: String, value: String, modifier: Modifier = Modifier) {
    Column(
        modifier.background(Color(0xFF18181B), RoundedCornerShape(9.dp))
            .border(1.dp, Color(0xFF303036), RoundedCornerShape(9.dp))
            .padding(9.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        Text(label, color = Color(0xFF71717A), fontSize = 8.sp, fontWeight = FontWeight.Bold)
        Text(value, color = Color(0xFFE4E4E7), fontSize = 11.sp, fontWeight = FontWeight.Black)
    }
}
