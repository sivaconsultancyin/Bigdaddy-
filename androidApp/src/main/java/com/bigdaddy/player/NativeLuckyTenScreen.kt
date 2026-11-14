package com.bigdaddy.player

import android.os.SystemClock
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.bigdaddy.player.domain.DemoOutcome
import com.bigdaddy.player.domain.DiceEngine
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.security.SecureRandom
import java.util.UUID

private enum class DiceRoundPhase { READY, BETTING, ROLLING, RESULT }

@Composable
fun NativeLuckyTenScreen(onRoundCompleted: (DemoOutcome, Long, Long) -> Unit) {
    val scope = rememberCoroutineScope()
    val engine = remember { DiceEngine() }
    var phase by remember { mutableStateOf(DiceRoundPhase.READY) }
    var secondsLeft by remember { mutableStateOf(14) }
    var resultNumber by remember { mutableStateOf<Int?>(null) }
    var selectedMarket by remember { mutableStateOf("small") }
    var running by remember { mutableStateOf(false) }

    val markets = listOf("1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "small", "big", "even", "odd")

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("LUCKY 10 DICE", style = MaterialTheme.typography.headlineSmall)
        Text("Native APK round · Virtual demo only", style = MaterialTheme.typography.bodySmall)
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    when (phase) {
                        DiceRoundPhase.READY -> "Ready to start"
                        DiceRoundPhase.BETTING -> "BETTING OPEN · $secondsLeft"
                        DiceRoundPhase.ROLLING -> "DICE ROLLING…"
                        DiceRoundPhase.RESULT -> "ROUND RESULT"
                    },
                    style = MaterialTheme.typography.titleLarge
                )
                Text(resultNumber?.toString() ?: "—", style = MaterialTheme.typography.displayLarge)
                if (phase == DiceRoundPhase.RESULT) {
                    val multiplier = engine.payoutMultiplier(selectedMarket, resultNumber ?: 0)
                    Text(if (multiplier > 0) "Selected demo market: $selectedMarket · $multiplier×" else "Selected demo market: $selectedMarket · No win")
                }
            }
        }
        Text("Select a virtual market (no money is wagered)", style = MaterialTheme.typography.titleMedium)
        markets.chunked(5).forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                row.forEach { market ->
                    if (selectedMarket == market) {
                        Button(onClick = { if (!running) selectedMarket = market }, enabled = !running) { Text(market.uppercase()) }
                    } else {
                        OutlinedButton(onClick = { if (!running) selectedMarket = market }, enabled = !running) { Text(market.uppercase()) }
                    }
                }
            }
        }
        Button(
            enabled = !running,
            modifier = Modifier.fillMaxWidth(),
            onClick = {
                scope.launch {
                    running = true
                    resultNumber = null
                    val started = SystemClock.elapsedRealtime()
                    phase = DiceRoundPhase.BETTING
                    for (remaining in 14 downTo 1) {
                        secondsLeft = remaining
                        delay(1_000)
                    }
                    phase = DiceRoundPhase.ROLLING
                    delay(4_500)
                    val outcome = engine.play(SecureRandom().nextLong())
                    val rolled = outcome.result.substringAfter(": ").toInt()
                    resultNumber = rolled
                    phase = DiceRoundPhase.RESULT
                    val ended = SystemClock.elapsedRealtime()
                    onRoundCompleted(
                        DemoOutcome(
                            gameCode = "dice",
                            roundId = UUID.randomUUID().toString(),
                            result = "Lucky 10: $rolled · Market $selectedMarket · ${engine.payoutMultiplier(selectedMarket, rolled)}× demo"
                        ),
                        started,
                        ended
                    )
                    delay(5_000)
                    phase = DiceRoundPhase.READY
                    running = false
                }
            }
        ) { Text(if (running) "Round in progress…" else "Start Lucky 10 round") }
        Text(
            "This is virtual local play only. No bet, wallet debit, payout, or Supabase game request is made.",
            style = MaterialTheme.typography.bodySmall
        )
    }
}
