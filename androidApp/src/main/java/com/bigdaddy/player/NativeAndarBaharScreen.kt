package com.bigdaddy.player

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
import com.bigdaddy.player.domain.AndarBaharCardDeal
import com.bigdaddy.player.domain.AndarBaharEngine
import com.bigdaddy.player.domain.DemoOutcome
import com.bigdaddy.player.domain.PlayingCard
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.security.SecureRandom
import java.util.Collections
import java.util.UUID

private enum class AndarBaharPhase { READY, BETTING, DEALING, RESULT }

@Composable
fun NativeAndarBaharScreen(onRoundCompleted: (DemoOutcome, Long, Long) -> Unit) {
    val scope = rememberCoroutineScope()
    val engine = remember { AndarBaharEngine() }
    var phase by remember { mutableStateOf(AndarBaharPhase.READY) }
    var secondsLeft by remember { mutableStateOf(13) }
    var joker by remember { mutableStateOf<PlayingCard?>(null) }
    var dealt by remember { mutableStateOf<List<AndarBaharCardDeal>>(emptyList()) }
    var firstSide by remember { mutableStateOf("ANDAR") }
    var winner by remember { mutableStateOf<String?>(null) }
    var running by remember { mutableStateOf(false) }

    fun createDeal(): Pair<PlayingCard, List<AndarBaharCardDeal>> {
        val deck = listOf('S', 'H', 'D', 'C')
            .flatMap { suit -> (2..14).map { rank -> PlayingCard(rank, suit) } }
            .toMutableList()
        Collections.shuffle(deck, SecureRandom())
        return deck.first() to engine.dealSequence(deck)

    }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("ANDAR BAHAR", style = MaterialTheme.typography.headlineSmall)
        Text("Native APK round · Virtual demo only", style = MaterialTheme.typography.bodySmall)
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    when (phase) {
                        AndarBaharPhase.READY -> "Ready to start"
                        AndarBaharPhase.BETTING -> "BETTING OPEN · $secondsLeft"
                        AndarBaharPhase.DEALING -> "DEALING CARDS · ${dealt.size}"
                        AndarBaharPhase.RESULT -> "ROUND RESULT"
                    },
                    style = MaterialTheme.typography.titleLarge
                )
                Text("JOKER  ·  ${joker?.label() ?: "—"}", style = MaterialTheme.typography.headlineMedium)
                Text("First card side: $firstSide")
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                    Column {
                        Text("ANDAR")
                        Text(dealt.filter { it.side == "ANDAR" }.takeLast(5).joinToString("  ") { it.card.label() }.ifBlank { "—" })
                    }
                    Column {
                        Text("BAHAR")
                        Text(dealt.filter { it.side == "BAHAR" }.takeLast(5).joinToString("  ") { it.card.label() }.ifBlank { "—" })
                    }
                }
                if (phase == AndarBaharPhase.RESULT) {
                    Text("Winner: $winner", style = MaterialTheme.typography.headlineMedium)
                    Text("Winning card: ${dealt.lastOrNull()?.card?.label() ?: "—"} · Total cards: ${dealt.size}")
                }
            }
        }
        Button(
            enabled = !running,
            modifier = Modifier.fillMaxWidth(),
            onClick = {
                scope.launch {
                    running = true
                    dealt = emptyList()
                    winner = null
                    val started = System.currentTimeMillis()
                    val (jokerCard, queue) = createDeal()
                    joker = jokerCard
                    firstSide = engine.openingSide(jokerCard.suit)
                    phase = AndarBaharPhase.BETTING
                    for (remaining in 13 downTo 1) {
                        secondsLeft = remaining
                        delay(1_000)
                    }
                    phase = AndarBaharPhase.DEALING
                    for (item in queue) {
                        dealt = dealt + item
                        delay(650)
                    }
                    winner = queue.lastOrNull()?.side ?: firstSide
                    delay(1_200)
                    phase = AndarBaharPhase.RESULT
                    val ended = System.currentTimeMillis()
                    onRoundCompleted(
                        DemoOutcome(
                            gameCode = "andar_bahar",
                            roundId = UUID.randomUUID().toString(),
                            result = "Joker ${jokerCard.label()} · $winner · ${queue.size} cards"
                        ),
                        started,
                        ended
                    )
                    delay(6_000)
                    phase = AndarBaharPhase.READY
                    running = false
                }
            }
        ) { Text(if (running) "Round in progress…" else "Start Andar Bahar round") }
        Text(
            "Legacy deal rule: black Joker (Spades/Clubs) starts Andar; red Joker (Hearts/Diamonds) starts Bahar. Cards alternate until the first rank match. Virtual demo only; no wager or wallet payout.",
            style = MaterialTheme.typography.bodySmall
        )
    }
}
