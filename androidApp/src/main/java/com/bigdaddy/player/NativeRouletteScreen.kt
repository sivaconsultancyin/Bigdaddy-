package com.bigdaddy.player

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
import com.bigdaddy.player.domain.RouletteEngine
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.security.SecureRandom
import java.util.UUID

private enum class RoulettePhase { READY, BETTING, SPINNING, RESULT }

@Composable
fun NativeRouletteScreen(onRoundCompleted: (DemoOutcome, Long, Long) -> Unit) {
    val scope = rememberCoroutineScope()
    val engine = remember { RouletteEngine() }
    var phase by remember { mutableStateOf(RoulettePhase.READY) }
    var secondsLeft by remember { mutableStateOf(14) }
    var wheelNumber by remember { mutableStateOf<Int?>(null) }
    var selectedMarket by remember { mutableStateOf("red") }
    var running by remember { mutableStateOf(false) }

    val markets = listOf("red", "black", "even", "odd", "low", "high", "dozen1", "dozen2", "dozen3", "col1", "col2", "col3")

    fun marketWins(number: Int): Boolean = when (selectedMarket) {
        "red" -> engine.color(number) == "RED"
        "black" -> engine.color(number) == "BLACK"
        "even" -> number != 0 && number % 2 == 0
        "odd" -> number != 0 && number % 2 != 0
        "low" -> number in 1..18
        "high" -> number in 19..36
        "dozen1" -> number in 1..12
        "dozen2" -> number in 13..24
        "dozen3" -> number in 25..36
        "col1" -> number != 0 && number % 3 == 1
        "col2" -> number != 0 && number % 3 == 2
        "col3" -> number != 0 && number % 3 == 0
        else -> false
    }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("EUROPEAN ROULETTE", style = MaterialTheme.typography.headlineSmall)
        Text("Single-zero wheel · Native APK · Virtual demo only", style = MaterialTheme.typography.bodySmall)
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    when (phase) {
                        RoulettePhase.READY -> "Ready to start"
                        RoulettePhase.BETTING -> "BETTING OPEN · $secondsLeft"
                        RoulettePhase.SPINNING -> "WHEEL SPINNING…"
                        RoulettePhase.RESULT -> "ROUND RESULT"
                    },
                    style = MaterialTheme.typography.titleLarge
                )
                Text(wheelNumber?.toString() ?: "—", style = MaterialTheme.typography.displayLarge)
                wheelNumber?.let { number ->
                    Text("Pocket: ${engine.color(number)}", style = MaterialTheme.typography.titleMedium)
                    if (phase == RoulettePhase.RESULT) {
                        Text(if (marketWins(number)) "Market $selectedMarket: WIN · ${engine.payoutMultiplier(selectedMarket)}× demo" else "Market $selectedMarket: NO WIN")
                    }
                }
            }
        }
        Text("Select a virtual market", style = MaterialTheme.typography.titleMedium)
        markets.chunked(4).forEach { row ->
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
                    wheelNumber = null
                    val started = System.currentTimeMillis()
                    phase = RoulettePhase.BETTING
                    for (remaining in 14 downTo 1) {
                        secondsLeft = remaining
                        delay(1_000)
                    }
                    phase = RoulettePhase.SPINNING
                    val seed = SecureRandom().nextLong()
                    val finalOutcome = engine.play(seed)
                    val finalNumber = finalOutcome.result.substringBefore(" · ").toInt()
                    repeat(50) { tick ->
                        wheelNumber = SecureRandom().nextInt(37)
                        delay(140L + tick * 2L)
                    }
                    wheelNumber = finalNumber
                    phase = RoulettePhase.RESULT
                    val ended = System.currentTimeMillis()
                    onRoundCompleted(
                        DemoOutcome(
                            gameCode = "roulette",
                            roundId = UUID.randomUUID().toString(),
                            result = "European Roulette: $finalNumber · ${engine.color(finalNumber)} · Market $selectedMarket"
                        ),
                        started,
                        ended
                    )
                    delay(5_500)
                    phase = RoulettePhase.READY
                    running = false
                }
            }
        ) { Text(if (running) "Round in progress…" else "Start Roulette round") }
        Text(
            "European single-zero wheel (0–36). Zero does not win red/black, even/odd, low/high, dozens, or columns. Virtual demo only: no wager, wallet debit, or payout.",
            style = MaterialTheme.typography.bodySmall
        )
    }
}
