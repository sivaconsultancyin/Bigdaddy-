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
import com.bigdaddy.player.domain.DragonTigerEngine
import com.bigdaddy.player.domain.PlayingCard
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.security.SecureRandom
import java.util.Collections
import java.util.UUID

private enum class DragonTigerPhase { READY, BETTING, REVEALING, RESULT }

@Composable
fun NativeDragonTigerScreen(onRoundCompleted: (DemoOutcome, Long, Long) -> Unit) {
    val scope = rememberCoroutineScope()
    val engine = remember { DragonTigerEngine() }
    var phase by remember { mutableStateOf(DragonTigerPhase.READY) }
    var secondsLeft by remember { mutableStateOf(12) }
    var dragonCard by remember { mutableStateOf<PlayingCard?>(null) }
    var tigerCard by remember { mutableStateOf<PlayingCard?>(null) }
    var winner by remember { mutableStateOf<String?>(null) }
    var running by remember { mutableStateOf(false) }

    fun dealCards(): Pair<PlayingCard, PlayingCard> {
        val cards = listOf('S', 'H', 'D', 'C').flatMap { suit -> (2..14).map { rank -> PlayingCard(rank, suit) } }
            .toMutableList()
        Collections.shuffle(cards, SecureRandom())
        return cards[0] to cards[1]
    }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("DRAGON  •  TIGER", style = MaterialTheme.typography.headlineSmall)
        Text("Native APK round · Virtual demo only", style = MaterialTheme.typography.bodySmall)
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    when (phase) {
                        DragonTigerPhase.READY -> "Ready to start"
                        DragonTigerPhase.BETTING -> "BETTING OPEN"
                        DragonTigerPhase.REVEALING -> "REVEALING CARDS"
                        DragonTigerPhase.RESULT -> "ROUND RESULT"
                    },
                    style = MaterialTheme.typography.titleLarge
                )
                if (phase == DragonTigerPhase.BETTING) {
                    Text("Next reveal in $secondsLeft seconds")
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                    Column {
                        Text("DRAGON")
                        Text(if (phase >= DragonTigerPhase.REVEALING) dragonCard?.label() ?: "—" else "🂠",
                            style = MaterialTheme.typography.headlineMedium)
                    }
                    Column {
                        Text("TIGER")
                        Text(if (phase >= DragonTigerPhase.REVEALING) tigerCard?.label() ?: "—" else "🂠",
                            style = MaterialTheme.typography.headlineMedium)
                    }
                }
                if (phase == DragonTigerPhase.RESULT) {
                    Text("Winner: $winner", style = MaterialTheme.typography.headlineMedium)
                    Text("Ace is treated as the lowest card. Suits do not break ties.")
                }
            }
        }
        Button(
            enabled = !running,
            modifier = Modifier.fillMaxWidth(),
            onClick = {
                scope.launch {
                    running = true
                    winner = null
                    dragonCard = null
                    tigerCard = null
                    val started = SystemClock.elapsedRealtime()
                    val (dragon, tiger) = dealCards()
                    phase = DragonTigerPhase.BETTING
                    for (remaining in 12 downTo 1) {
                        secondsLeft = remaining
                        delay(1_000)
                    }
                    phase = DragonTigerPhase.REVEALING
                    dragonCard = dragon
                    tigerCard = tiger
                    winner = engine.winner(dragon.rank, tiger.rank)
                    delay(4_500)
                    phase = DragonTigerPhase.RESULT
                    val ended = SystemClock.elapsedRealtime()
                    onRoundCompleted(
                        DemoOutcome(
                            gameCode = "dragon_tiger",
                            roundId = UUID.randomUUID().toString(),
                            result = "Dragon ${dragon.label()} · Tiger ${tiger.label()} · $winner"
                        ),
                        started,
                        ended
                    )
                    delay(5_500)
                    phase = DragonTigerPhase.READY
                    running = false
                }
            }
        ) { Text(if (running) "Round in progress…" else "Start Dragon Tiger round") }
        Text(
            "This is local virtual play. No wager is placed and no Supabase wallet balance is changed.",
            style = MaterialTheme.typography.bodySmall
        )
    }
}
