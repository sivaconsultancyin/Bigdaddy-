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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp
import com.bigdaddy.player.domain.AviatorGameEngine
import com.bigdaddy.player.domain.DemoOutcome
import com.bigdaddy.player.domain.FlightAnimationController
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.Locale

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
        Text("Native APK engine · Local virtual demo", style = MaterialTheme.typography.bodySmall)
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    when (phase) {
                        AviatorPhase.READY -> "READY"
                        AviatorPhase.BETTING -> "ROUND STARTING · $secondsLeft"
                        AviatorPhase.FLYING -> "FLYING"
                        AviatorPhase.CRASHED -> "CRASHED"
                    },
                    style = MaterialTheme.typography.titleMedium
                )
                Text(
                    String.format(Locale.US, "%.2fx", multiplier),
                    style = MaterialTheme.typography.displayLarge,
                    color = if (phase == AviatorPhase.CRASHED) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary
                )
                Box(Modifier.fillMaxWidth().height(190.dp)) {
                    Canvas(Modifier.fillMaxWidth().height(190.dp)) {
                        val left = 18f
                        val right = size.width - 18f
                        val top = 14f
                        val bottom = size.height - 14f
                        val chartWidth = right - left
                        val chartHeight = bottom - top
                        drawRect(
                            brush = Brush.verticalGradient(
                                listOf(Color(0xFF111D38), Color(0xFF090D1B), Color(0xFF170F28))
                            )
                        )
                        // Subtle stars and drifting cloud bands are tied to the same round clock.
                        for (i in 0..18) {
                            val x = ((i * 83f + elapsedMillis * (0.006f + (i % 3) * 0.002f)) % size.width)
                            val y = 12f + (i * 37f % (size.height - 24f))
                            drawCircle(Color.White.copy(alpha = 0.25f), radius = 1.4f, center = Offset(x, y))
                        }
                        for (i in 0..2) {
                            val cloudX = ((i * 170f + elapsedMillis * 0.018f) % (size.width + 100f)) - 50f
                            val cloudY = 34f + i * 42f
                            val cloud = Color(0xFF9CB5D8).copy(alpha = 0.12f)
                            drawCircle(cloud, 17f, Offset(cloudX, cloudY))
                            drawCircle(cloud, 23f, Offset(cloudX + 18f, cloudY + 3f))
                            drawCircle(cloud, 15f, Offset(cloudX + 39f, cloudY + 5f))
                        }
                        for (i in 1..3) {
                            val y = top + chartHeight * i / 4f
                            drawLine(Color(0xFF91A5C9).copy(alpha = 0.16f), Offset(left, y), Offset(right, y), 1f)
                        }
                        val progress = animation.multiplierProgress(multiplier)
                        val xNow = left + chartWidth * progress
                        val yNow = bottom - chartHeight * progress
                        val flightPath = Path().apply {
                            moveTo(left, bottom)
                            cubicTo(left + chartWidth * 0.18f, bottom - chartHeight * 0.02f,
                                left + chartWidth * 0.42f, bottom - chartHeight * 0.18f,
                                xNow, yNow)
                        }
                        drawPath(flightPath, Color(0xFFFFB84D).copy(alpha = 0.18f), style = Stroke(width = 16f))
                        drawPath(flightPath, Color(0xFFFFC15A), style = Stroke(width = 5f))
                        val planeColor = if (phase == AviatorPhase.CRASHED) Color(0xFFFF5A55) else Color(0xFFFFE1A0)
                        drawCircle(planeColor.copy(alpha = 0.25f), radius = 19f, center = Offset(xNow, yNow))
                        val plane = Path().apply {
                            moveTo(xNow + 18f, yNow)
                            lineTo(xNow - 13f, yNow - 10f)
                            lineTo(xNow - 6f, yNow)
                            lineTo(xNow - 13f, yNow + 10f)
                            close()
                        }
                        drawPath(plane, planeColor)
                    }
                }
                Text("Elapsed: ${(elapsedMillis / 1000.0).let { String.format(Locale.US, "%.1fs", it) }}")
                result?.let { Text(it, style = MaterialTheme.typography.titleMedium) }
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
        ) { Text(if (running) "Flight in progress…" else "Start flight") }
        Text(
            "The multiplier and flight curve run locally in the APK. This is a virtual demo: no server game round, bet, cashout, wallet debit, or payout is performed.",
            style = MaterialTheme.typography.bodySmall
        )
    }
}
