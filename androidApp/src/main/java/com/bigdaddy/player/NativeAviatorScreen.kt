package com.bigdaddy.player

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.bigdaddy.player.data.BigDaddyApi
import com.bigdaddy.player.data.NativeAviatorState
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import java.util.Locale
import kotlin.math.pow

@Composable
internal fun NativeAviatorScreen(
    api: BigDaddyApi,
    token: String
) {
    var state by remember(token) { mutableStateOf<NativeAviatorState?>(null) }
    var loading by remember(token) { mutableStateOf(true) }
    var error by remember(token) { mutableStateOf<String?>(null) }

    LaunchedEffect(token) {
        while (isActive) {
            try {
                state = api.aviatorState(token)
                error = null
                loading = false
            } catch (failure: Exception) {
                error = failure.message ?: "Aviator live state is temporarily unavailable."
                loading = false
            }
            delay(if (state?.round?.status == "RUNNING") 1_000L else 1_500L)
        }
    }

    val round = state?.round
    val status = round?.status ?: "WAITING"
    val running = status == "RUNNING"
    val crashed = status == "CRASHED" || status == "SETTLED"
    val flightProgress = remember { Animatable(0f) }
    val crashProgress = remember { Animatable(0f) }
    val starTransition = rememberInfiniteTransition(label = "aviator-starfield")
    val starPhase by starTransition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 2_400, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "aviator-star-motion"
    )

    LaunchedEffect(round?.id, round?.status, round?.multiplier) {
        val target = if (running || crashed) {
            (((round?.multiplier ?: 1.0) - 1.0).toFloat() / 9f).coerceIn(0f, 1f)
        } else {
            0f
        }
        if (status == "WAITING" || round == null) {
            flightProgress.snapTo(0f)
        } else {
            flightProgress.animateTo(target, tween(850, easing = LinearEasing))
        }
        if (crashed) {
            crashProgress.snapTo(0f)
            crashProgress.animateTo(1f, tween(750, easing = LinearEasing))
        } else {
            crashProgress.snapTo(0f)
        }
    }

    val statusLabel = when (status) {
        "WAITING" -> if (round == null) "WAITING FOR SERVER ROUND" else "WAITING FOR TAKE-OFF"
        "RUNNING" -> "FLIGHT IN PROGRESS"
        "CRASHED", "SETTLED" -> "FLEW AWAY"
        else -> status.replace('_', ' ')
    }
    val statusColor = when {
        running -> Color(0xFF86EFAC)
        crashed -> Color(0xFFFB7185)
        else -> Color(0xFFFBBF24)
    }

    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = Color(0xFF09090B)),
            shape = RoundedCornerShape(16.dp)
        ) {
            Column(
                modifier = Modifier.fillMaxWidth().padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text("AVIATOR LIVE", color = Color(0xFFFCDFA0), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Black)
                        Text("Server-authoritative round feed", color = Color(0xFF71717A), style = MaterialTheme.typography.labelSmall)
                    }
                    val connectionLabel = when {
                        error != null -> "OFFLINE"
                        state != null -> "CONNECTED"
                        else -> "CONNECTING"
                    }
                    Text(
                        connectionLabel,
                        color = when (connectionLabel) {
                            "CONNECTED" -> Color(0xFF86EFAC)
                            "CONNECTING" -> Color(0xFFFBBF24)
                            else -> Color(0xFFFCA5A5)
                        },
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier
                            .background(
                                if (error == null) Color(0x1A22C55E) else Color(0x1AF87171),
                                RoundedCornerShape(20.dp)
                            )
                            .padding(horizontal = 9.dp, vertical = 5.dp)
                    )
                }

                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .aspectRatio(16f / 8.4f)
                        .clip(RoundedCornerShape(12.dp))
                ) {
                    Canvas(Modifier.fillMaxSize()) {
                        val width = size.width
                        val height = size.height
                        val startY = height * 0.88f
                        val progress = flightProgress.value
                        val progressX = progress.pow(0.72f)
                        val progressY = progress.pow(1.15f)
                        val planeX = if (running || crashed) 14f + (width - 42f) * progressX else 14f
                        val planeY = if (running || crashed) startY - (startY - 38f) * progressY else startY
                        val multiplier = (round?.multiplier ?: 1.0).toFloat()
                        val speed = if (running) (1f + (multiplier - 1f) * 1.8f).coerceIn(1f, 12f) else 0.7f

                        drawRect(
                            brush = Brush.verticalGradient(
                                listOf(Color(0xFF06070A), Color(0xFF0B0C13), Color(0xFF020306))
                            )
                        )
                        for (x in 0..(width / 28f).toInt()) {
                            val gridX = x * 28f
                            drawLine(Color.White.copy(alpha = 0.025f), Offset(gridX, 0f), Offset(gridX, height), 1f)
                        }
                        for (y in 0..(height / 28f).toInt()) {
                            val gridY = y * 28f
                            drawLine(Color.White.copy(alpha = 0.025f), Offset(0f, gridY), Offset(width, gridY), 1f)
                        }

                        for (i in 0 until 45) {
                            val baseSpeed = 1.2f + (i % 7) * 0.42f
                            val travel = starPhase * (width + 20f) * speed
                            val x = ((i * 89f - travel) % (width + 20f) + (width + 20f)) % (width + 20f)
                            val y = (i * 47f % height)
                            val streak = if (running) baseSpeed * speed * 1.6f else baseSpeed
                            drawLine(
                                Color.White.copy(alpha = 0.18f + (i % 5) * 0.09f),
                                Offset(x, y),
                                Offset(x + streak, y),
                                if (i % 3 == 0) 1.8f else 1f
                            )
                        }

                        drawLine(Color.White.copy(alpha = 0.22f), Offset(0f, startY), Offset(planeX, startY), 2f)
                        val trajectory = Path().apply {
                            moveTo(0f, startY)
                            quadraticTo(planeX * 0.48f, startY + (planeY - startY) * 0.12f, planeX, planeY)
                        }
                        val area = Path().apply {
                            moveTo(0f, height)
                            lineTo(0f, startY)
                            quadraticTo(planeX * 0.48f, startY + (planeY - startY) * 0.12f, planeX, planeY)
                            lineTo(planeX, height)
                            close()
                        }
                        if (running || crashed) {
                            drawPath(
                                area,
                                Brush.verticalGradient(
                                    listOf(Color(0x44EF4444), Color(0x22EAB308), Color.Transparent),
                                    startY = planeY.coerceAtMost(startY),
                                    endY = height
                                )
                            )
                            drawPath(trajectory, Color(0x55EF4444), style = Stroke(width = 18f))
                            drawPath(trajectory, Color(0xFFF43F5E), style = Stroke(width = 3f))
                        }

                        if (crashed) {
                            val burst = crashProgress.value
                            val ringAlpha = (1f - burst).coerceAtLeast(0f)
                            drawCircle(
                                Color(0xFFF43F5E).copy(alpha = ringAlpha),
                                radius = 10f + burst * 48f,
                                center = Offset(planeX, planeY),
                                style = Stroke(width = 3f)
                            )
                            for (i in 0 until 40) {
                                val angle = i * 2.399f
                                val radius = 12f + (i % 6) * 5f + burst * 42f
                                val point = Offset(
                                    planeX + kotlin.math.cos(angle) * radius,
                                    planeY + kotlin.math.sin(angle) * radius
                                )
                                drawCircle(
                                    (if (i % 3 == 0) Color(0xFFFFC15A) else Color(0xFFEF4444)).copy(alpha = ringAlpha),
                                    radius = 1.5f + (i % 3),
                                    center = point
                                )
                            }
                        } else {
                            for (i in 0..5) {
                                val fade = 1f - i / 7f
                                drawCircle(
                                    Color(0xFFFF8A45).copy(alpha = 0.16f * fade),
                                    radius = 3f + i * 1.2f,
                                    center = Offset(planeX - 13f - i * 4f, planeY + 2f + kotlin.math.sin(i.toFloat()) * 2f)
                                )
                            }
                            drawCircle(Color(0x66FF3B30), 18f, Offset(planeX, planeY))
                            val aircraft = Path().apply {
                                moveTo(planeX + 18f, planeY - 2f)
                                lineTo(planeX - 4f, planeY - 5f)
                                lineTo(planeX - 11f, planeY - 13f)
                                lineTo(planeX - 15f, planeY - 12f)
                                lineTo(planeX - 12f, planeY - 3f)
                                lineTo(planeX - 20f, planeY + 1f)
                                lineTo(planeX - 13f, planeY + 5f)
                                lineTo(planeX - 15f, planeY + 12f)
                                lineTo(planeX - 10f, planeY + 11f)
                                lineTo(planeX - 3f, planeY + 5f)
                                close()
                            }
                            drawPath(aircraft, Color(0xFFE11D48))
                            drawCircle(Color(0xFF38BDF8), 2.4f, Offset(planeX + 4.5f, planeY - 2f))
                        }
                    }

                    Column(
                        modifier = Modifier.align(Alignment.Center),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(2.dp)
                    ) {
                        if (running) {
                            Text(
                                String.format(Locale.US, "%.2fx", round?.multiplier ?: 1.0),
                                color = Color.White,
                                style = MaterialTheme.typography.displayMedium,
                                fontWeight = FontWeight.Black
                            )
                        } else if (crashed) {
                            Text("FLEW AWAY!", color = Color(0xFFF43F5E), style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Black)
                            Text(
                                String.format(Locale.US, "%.2fx", round?.crashMultiplier ?: round?.multiplier ?: 1.0),
                                color = Color(0xFFF43F5E),
                                style = MaterialTheme.typography.displaySmall,
                                fontWeight = FontWeight.Black
                            )
                        } else {
                            Text("WAITING", color = Color(0xFFFCDFA0), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Black)
                        }
                    }
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(statusLabel, color = statusColor, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
                    Text(
                        round?.let { "ROUND #${it.roundNumber}" } ?: if (loading) "CONNECTING…" else "NO ACTIVE ROUND",
                        color = Color(0xFFA1A1AA),
                        style = MaterialTheme.typography.labelSmall
                    )
                }
                error?.let {
                    Text("Live state refresh failed: $it", color = Color(0xFFFCA5A5), style = MaterialTheme.typography.bodySmall)
                }
                if (loading && round == null) {
                    Text("Connecting to the authenticated game service…", color = Color(0xFFA1A1AA), style = MaterialTheme.typography.bodySmall)
                }
            }
        }

        Text("RECENT CRASHES", color = Color(0xFFFCDFA0), style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
        val recent = state?.history.orEmpty()
        if (recent.isEmpty()) {
            Text("No settled rounds have been returned by the server yet.", color = Color(0xFF71717A), style = MaterialTheme.typography.bodySmall)
        } else {
            Row(
                modifier = Modifier.fillMaxWidth().horizontalScroll(androidx.compose.foundation.rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                recent.take(12).forEach { item ->
                    Column(
                        modifier = Modifier
                            .background(Color(0xFF18181B), RoundedCornerShape(8.dp))
                            .padding(horizontal = 9.dp, vertical = 6.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Text("#${item.roundNumber}", color = Color(0xFF71717A), style = MaterialTheme.typography.labelSmall)
                        Text(
                            String.format(Locale.US, "%.2fx", item.crashMultiplier),
                            color = if (item.crashMultiplier >= 2.0) Color(0xFF86EFAC) else Color(0xFFFCA5A5),
                            style = MaterialTheme.typography.labelMedium,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }
            }
        }
        Text(
            "Live round values and crash results are read only from the authenticated server API. Betting and cashout controls are not enabled in this native client yet.",
            color = Color(0xFF71717A),
            style = MaterialTheme.typography.bodySmall
        )
    }
}
