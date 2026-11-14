package com.bigdaddy.player.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp
import com.bigdaddy.player.domain.AviatorGameEngine
import com.bigdaddy.player.domain.AviatorRoundManager
import com.bigdaddy.player.domain.AviatorSnapshot
import com.bigdaddy.player.domain.DemoOutcome
import java.util.UUID
import kotlin.math.exp

@Composable
fun AviatorDemoScreen(onCompleted: (DemoOutcome, Long, Long) -> Unit) {
    val engine = remember { AviatorGameEngine() }
    var round by remember { mutableStateOf<AviatorRoundManager?>(null) }
    var snapshot by remember { mutableStateOf(AviatorSnapshot(0L, 1.0, false)) }
    var running by remember { mutableStateOf(false) }
    var startedAtEpochMillis by remember { mutableStateOf(0L) }

    LaunchedEffect(round) {
        val active = round ?: return@LaunchedEffect
        while (true) {
            withFrameNanos { }
            val next = active.snapshot()
            snapshot = next
            if (next.crashed) {
                running = false
                onCompleted(DemoOutcome("aviator", UUID.randomUUID().toString(), "DEMO CRASH @ ${String.format("%.2f", next.multiplier)}x"), startedAtEpochMillis, System.currentTimeMillis())
                break
            }
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
        Text("Aviator · Local demo", style = MaterialTheme.typography.headlineSmall)
        Text("Multiplier: ${String.format("%.2f", snapshot.multiplier)}x", style = MaterialTheme.typography.headlineMedium)
        Canvas(Modifier.fillMaxWidth().height(220.dp)) {
            val progress = (1.0 - exp(-snapshot.elapsedMillis / 12_000.0)).toFloat().coerceIn(0f, 1f)
            val x = size.width * progress
            val y = size.height * (0.92f - (snapshot.multiplier.toFloat() - 1f).coerceAtMost(12f) / 14f)
            val path = Path().apply {
                moveTo(0f, size.height * 0.92f)
                cubicTo(size.width * 0.25f, size.height * 0.88f, x * 0.7f, y + 35f, x, y)
            }
            drawPath(path, Color(0xFFFFC247), style = Stroke(width = 6f))
            drawCircle(Color.White, radius = 8f, center = Offset(x, y))
        }
        if (snapshot.crashed) Text("Round crashed · Demo only", color = MaterialTheme.colorScheme.error)
        Button(
            onClick = {
                startedAtEpochMillis = System.currentTimeMillis()
                val next = engine.createDemoRound(System.nanoTime())
                next.start()
                snapshot = AviatorSnapshot(0L, 1.0, false)
                round = next
                running = true
            },
            enabled = !running,
            modifier = Modifier.fillMaxWidth()
        ) { Text(if (running) "Flight running…" else "Start local demo flight") }
        Text("The frame loop and multiplier share the same monotonic local clock. No network calls or wallet payouts occur.")
    }
}
