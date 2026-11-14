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
                        val left = 12f
                        val right = size.width - 12f
                        val top = 12f
                        val bottom = size.height - 12f
                        val chartWidth = right - left
                        val chartHeight = bottom - top
                        for (i in 1..3) {
                            val y = top + chartHeight * i / 4f
                            drawLine(Color.LightGray.copy(alpha = 0.35f), Offset(left, y), Offset(right, y), 1f)
                        }
                        for (i in 1..5) {
                            val x = left + chartWidth * i / 6f
                            drawLine(Color.LightGray.copy(alpha = 0.25f), Offset(x, top), Offset(x, bottom), 1f)
                        }
                        val progress = animation.multiplierProgress(multiplier)
                        val xNow = left + chartWidth * progress
                        val yNow = bottom - chartHeight * progress
                        val path = Path().apply {
                            moveTo(left, bottom)
                            cubicTo(left + chartWidth * 0.18f, bottom - chartHeight * 0.02f,
                                left + chartWidth * 0.42f, bottom - chartHeight * 0.18f,
                                xNow, yNow)
                        }
                        drawPath(path, Color(0xFF16A34A), style = Stroke(width = 5f))
                        drawCircle(
                            color = if (phase == AviatorPhase.CRASHED) Color(0xFFDC2626) else Color(0xFF16A34A),
                            radius = 8f,
                            center = Offset(xNow, yNow)
                        )
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
                        delay(40)
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
