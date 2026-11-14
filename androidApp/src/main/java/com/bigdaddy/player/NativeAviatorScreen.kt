package com.bigdaddy.player

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp
import com.bigdaddy.player.domain.AviatorGameEngine
import com.bigdaddy.player.domain.DemoOutcome
import com.bigdaddy.player.domain.FlightAnimationController
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.Locale
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin

private enum class AviatorPhase { READY, BETTING, FLYING, CRASHED }

@Composable
internal fun NativeAviatorScreen(
    onRoundCompleted: (DemoOutcome, Long, Long) -> Unit
) {
    val engine = remember { AviatorGameEngine() }
    val animation = remember { FlightAnimationController() }
    val scope = rememberCoroutineScope()
    var phase by remember { mutableStateOf(AviatorPhase.READY) }
    var running by remember { mutableStateOf(false) }
    var secondsLeft by remember { mutableStateOf(5) }
    var elapsedMillis by remember { mutableStateOf(0L) }
    var multiplier by remember { mutableStateOf(1.0) }
    var result by remember { mutableStateOf<String?>(null) }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
        Text("AVIATOR", style = MaterialTheme.typography.headlineSmall)
        Text("Native visual demo · live server connection pending", style = MaterialTheme.typography.bodySmall)
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    when (phase) {
                        AviatorPhase.READY -> "WAITING FOR TAKE-OFF"
                        AviatorPhase.BETTING -> "BETTING · $secondsLeft"
                        AviatorPhase.FLYING -> "FLIGHT IN PROGRESS"
                        AviatorPhase.CRASHED -> "FLIGHT CRASHED"
                    },
                    style = MaterialTheme.typography.titleMedium,
                    color = Color(0xFFFBBF24)
                )
                Text(
                    String.format(Locale.US, "%.2fx", multiplier),
                    style = MaterialTheme.typography.displayLarge,
                    color = if (phase == AviatorPhase.CRASHED) Color(0xFFFB5555) else Color(0xFFF4F4F5)
                )
                Box(Modifier.fillMaxWidth().height(220.dp)) {
                    Canvas(Modifier.fillMaxWidth().height(220.dp)) {
                        val width = size.width
                        val height = size.height
                        val left = 0f
                        val right = width - 16f
                        val startY = height * 0.88f
                        val topY = 28f
                        val normalized = animation.multiplierProgress(multiplier, 10.0)
                        val progress = if (phase == AviatorPhase.READY || phase == AviatorPhase.BETTING) 0f else normalized
                        val planeX = 16f + (right - 42f) * progress
                        val planeY = startY - (startY - topY) * progress
                        val speed = if (phase == AviatorPhase.FLYING) min(1f + ((multiplier - 1.0).toFloat() * 1.8f), 12f) else 0.7f

                        // Website-matched dark space background and subtle grid.
                        drawRect(brush = Brush.verticalGradient(
                            listOf(Color(0xFF06070A), Color(0xFF0B0C13), Color(0xFF020306))
                        ))
                        for (x in 0..(width / 28f).toInt()) {
                            val gridX = x * 28f
                            drawLine(Color.White.copy(alpha = 0.025f), Offset(gridX, 0f), Offset(gridX, height), 1f)
                        }
                        for (y in 0..(height / 28f).toInt()) {
                            val gridY = y * 28f
                            drawLine(Color.White.copy(alpha = 0.025f), Offset(0f, gridY), Offset(width, gridY), 1f)
                        }

                        // Moving star streaks accelerate with the displayed multiplier.
                        for (i in 0 until 45) {
                            val baseSpeed = 1.2f + (i % 7) * 0.42f
                            val travel = elapsedMillis.toFloat() * 0.045f * baseSpeed * speed
                            val x = ((i * 89f - travel) % (width + 16f) + (width + 16f)) % (width + 16f)
                            val y = (i * 47f % height)
                            val streak = if (phase == AviatorPhase.FLYING) baseSpeed * speed * 1.5f else baseSpeed
                            drawLine(Color.White.copy(alpha = 0.18f + (i % 5) * 0.09f),
                                Offset(x, y), Offset(x + streak, y), if (i % 3 == 0) 1.8f else 1f)
                        }

                        // Runway and red trajectory glow.
                        drawLine(Color.White.copy(alpha = 0.22f), Offset(left, startY), Offset(planeX, startY), 2f)
                        val trajectory = Path().apply {
                            moveTo(left, startY)
                            quadraticTo(planeX * 0.48f, startY + (planeY - startY) * 0.12f, planeX, planeY)
                        }
                        val area = Path().apply {
                            moveTo(left, height)
                            lineTo(left, startY)
                            quadraticTo(planeX * 0.48f, startY + (planeY - startY) * 0.12f, planeX, planeY)
                            lineTo(planeX, height)
                            close()
                        }
                        drawPath(area, Brush.verticalGradient(
                            listOf(Color(0x44EF4444), Color(0x22EAB308), Color.Transparent),
                            startY = planeY.coerceAtMost(startY), endY = height
                        ))
                        drawPath(trajectory, Color(0x55EF4444), style = Stroke(width = 18f))
                        drawPath(trajectory, Color(0xFFEF4444), style = Stroke(width = 3.5f))

                        // Exhaust trail and glow behind the red aircraft.
                        for (i in 0..5) {
                            val fade = 1f - i / 7f
                            drawCircle(Color(0xFFFF8A45).copy(alpha = 0.16f * fade),
                                radius = 3f + i * 1.2f,
                                center = Offset(planeX - 13f - i * 4f, planeY + 2f + sin(i.toFloat()) * 2f))
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
                        drawPath(aircraft, if (phase == AviatorPhase.CRASHED) Color(0xFFEF4444) else Color(0xFFFF5B4D))
                        drawLine(Color(0xFFFFD4B8), Offset(planeX - 4f, planeY - 1f),
                            Offset(planeX + 12f, planeY - 2f), 1.4f)

                        // Crash burst is rendered only after the demo round reaches its terminal state.
                        if (phase == AviatorPhase.CRASHED) {
                            for (i in 0 until 36) {
                                val angle = i * 2.399f
                                val radius = 12f + (i % 6) * 5f
                                val point = Offset(planeX + cos(angle) * radius, planeY + sin(angle) * radius)
                                drawCircle(
                                    if (i % 3 == 0) Color(0xFFFFC15A) else Color(0xFFEF4444),
                                    radius = 1.5f + (i % 3),
                                    center = point
                                )
                            }
                        }
                    }
                }
                Text("Elapsed: ${String.format(Locale.US, "%.1fs", elapsedMillis / 1000.0)}",
                    color = Color(0xFFA1A1AA), style = MaterialTheme.typography.bodySmall)
                result?.let { Text(it, color = Color(0xFFFCA5A5), style = MaterialTheme.typography.titleSmall) }
            }
        }
        Button(
            enabled = !running,
            modifier = Modifier.fillMaxWidth(),
            onClick = {
                scope.launch {
                    running = true
                    phase = AviatorPhase.BETTING
                    result = null
                    multiplier = 1.0
                    elapsedMillis = 0L
                    val started = System.currentTimeMillis()
                    for (remaining in 5 downTo 1) {
                        secondsLeft = remaining
                        delay(1_000)
                    }
                    val round = engine.createDemoRound(System.nanoTime())
                    round.start()
                    phase = AviatorPhase.FLYING
                    var snapshot = round.snapshot()
                    while (!snapshot.crashed) {
                        elapsedMillis = snapshot.elapsedMillis
                        multiplier = snapshot.multiplier
                        delay(16)
                        snapshot = round.snapshot()
                    }
                    elapsedMillis = snapshot.elapsedMillis
                    multiplier = snapshot.multiplier
                    phase = AviatorPhase.CRASHED
                    val ended = System.currentTimeMillis()
                    val display = String.format(Locale.US, "%.2fx", snapshot.multiplier)
                    val outcome = DemoOutcome(gameCode = "aviator", result = "LOCAL DEMO CRASH @ $display")
                    result = outcome.result
                    running = false
                    onRoundCompleted(outcome, started, ended)
                }
            }
        ) { Text(if (running) "Flight in progress…" else "Start visual demo") }
        Text(
            "Visual-only local demo. The Website Aviator uses server-authoritative round state; this native screen is not yet connected to that live state. No bets, cashouts, wallet debits or payouts are made here.",
            style = MaterialTheme.typography.bodySmall,
            color = Color(0xFF71717A)
        )
    }
}
