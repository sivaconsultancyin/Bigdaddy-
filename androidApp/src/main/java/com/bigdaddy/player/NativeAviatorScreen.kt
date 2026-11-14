package com.bigdaddy.player

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
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
import androidx.compose.ui.unit.dp
import com.bigdaddy.player.domain.AviatorGameEngine
import com.bigdaddy.player.domain.DemoOutcome
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.Locale

@Composable
internal fun NativeAviatorScreen(
    onRoundCompleted: (DemoOutcome, Long, Long) -> Unit
) {
    val engine = remember { AviatorGameEngine() }
    val scope = rememberCoroutineScope()
    var running by remember { mutableStateOf(false) }
    var multiplier by remember { mutableStateOf(1.0) }
    var result by remember { mutableStateOf<String?>(null) }

    Column(Modifier.fillMaxWidth()) {
        Text("Aviator", style = MaterialTheme.typography.headlineSmall)
        Text("Native APK game engine · local demo mode")
        Card(Modifier.fillMaxWidth().padding(top = 16.dp)) {
            Column(Modifier.padding(20.dp)) {
                Text(
                    String.format(Locale.US, "%.2fx", multiplier),
                    style = MaterialTheme.typography.displayMedium
                )
                Text(if (running) "FLYING" else if (result != null) "ROUND COMPLETE" else "READY")
                result?.let { Text(it, modifier = Modifier.padding(top = 8.dp)) }
            }
        }
        Button(
            enabled = !running,
            modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
            onClick = {
                scope.launch {
                    running = true
                    result = null
                    multiplier = 1.0
                    val started = System.currentTimeMillis()
                    val round = engine.createDemoRound(System.nanoTime())
                    round.start()
                    var snapshot = round.snapshot()
                    while (!snapshot.crashed) {
                        multiplier = snapshot.multiplier
                        delay(40)
                        snapshot = round.snapshot()
                    }
                    multiplier = snapshot.multiplier
                    val ended = System.currentTimeMillis()
                    val display = String.format(Locale.US, "%.2fx", snapshot.multiplier)
                    val outcome = DemoOutcome(
                        gameCode = "aviator",
                        result = "LOCAL DEMO CRASH @ $display"
                    )
                    result = outcome.result
                    running = false
                    onRoundCompleted(outcome, started, ended)
                }
            }
        ) {
            Text(if (running) "Flight in progress…" else "Start local flight")
        }
        Text(
            "Demo only: this round is generated and settled on this device. It does not debit or credit the Supabase wallet.",
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.padding(top = 12.dp)
        )
    }
}
