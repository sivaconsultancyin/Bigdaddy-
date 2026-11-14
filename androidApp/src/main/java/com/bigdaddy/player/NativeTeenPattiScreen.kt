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
import com.bigdaddy.player.domain.DemoOutcome
import com.bigdaddy.player.domain.PlayingCard
import com.bigdaddy.player.domain.TeenPattiEngine
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.security.SecureRandom
import java.util.Collections
import java.util.UUID

private enum class TeenPattiPhase { READY, BETTING, DEALING, RESULT }

private fun PlayingCard.displayLabel(): String {
    val rankText = when (rank) {
        14 -> "A"
        13 -> "K"
        12 -> "Q"
        11 -> "J"
        else -> rank.toString()
    }
    val suitText = when (suit) {
        'S' -> "♠"
        'H' -> "♥"
        'D' -> "♦"
        else -> "♣"
    }
    return "$rankText$suitText"
}

@Composable
fun NativeTeenPattiScreen(onRoundCompleted: (DemoOutcome, Long, Long) -> Unit) {
    val scope = rememberCoroutineScope()
    val engine = remember { TeenPattiEngine() }
    var phase by remember { mutableStateOf(TeenPattiPhase.READY) }
    var secondsLeft by remember { mutableStateOf(15) }
    var playerCards by remember { mutableStateOf<List<PlayingCard>>(emptyList()) }
    var dealerCards by remember { mutableStateOf<List<PlayingCard>>(emptyList()) }
    var playerVisible by remember { mutableStateOf(0) }
    var dealerVisible by remember { mutableStateOf(0) }
    var winner by remember { mutableStateOf<String?>(null) }
    var playerHandName by remember { mutableStateOf("") }
    var dealerHandName by remember { mutableStateOf("") }
    var running by remember { mutableStateOf(false) }

    fun handName(cards: List<PlayingCard>): String {
        val value = engine.evaluate(cards)
        return when (value.category) {
            6 -> "Trail"
            5 -> "Pure Sequence"
            4 -> "Sequence"
            3 -> "Color (Flush)"
            2 -> "Pair"
            else -> "High Card"
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("TEEN PATTI", style = MaterialTheme.typography.headlineSmall)
        Text("3-card hand comparison · Native APK · Virtual demo only", style = MaterialTheme.typography.bodySmall)
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    when (phase) {
                        TeenPattiPhase.READY -> "Ready to start"
                        TeenPattiPhase.BETTING -> "ROUND STARTING · $secondsLeft"
                        TeenPattiPhase.DEALING -> "DEALING CARDS"
                        TeenPattiPhase.RESULT -> "ROUND RESULT"
                    },
                    style = MaterialTheme.typography.titleLarge
                )
                Text("PLAYER", style = MaterialTheme.typography.titleMedium)
                Text(
                    if (playerVisible == 0) "🂠   🂠   🂠"
                    else playerCards.take(playerVisible).joinToString("     ") { it.displayLabel() } +
                        if (playerVisible < 3) "     🂠".repeat(3 - playerVisible) else "",
                    style = MaterialTheme.typography.headlineMedium
                )
                if (phase == TeenPattiPhase.RESULT) Text("Hand: $playerHandName")
                Text("DEALER", style = MaterialTheme.typography.titleMedium)
                Text(
                    if (dealerVisible == 0) "🂠   🂠   🂠"
                    else dealerCards.take(dealerVisible).joinToString("     ") { it.displayLabel() } +
                        if (dealerVisible < 3) "     🂠".repeat(3 - dealerVisible) else "",
                    style = MaterialTheme.typography.headlineMedium
                )
                if (phase == TeenPattiPhase.RESULT) {
                    Text("Hand: $dealerHandName")
                    Text(
                        when (winner) {
                            "PLAYER" -> "YOU WIN"
                            "DEALER" -> "DEALER WINS"
                            else -> "TIE"
                        },
                        style = MaterialTheme.typography.headlineMedium
                    )
                }
            }
        }
        Button(
            enabled = !running,
            modifier = Modifier.fillMaxWidth(),
            onClick = {
                scope.launch {
                    running = true
                    playerCards = emptyList()
                    dealerCards = emptyList()
                    playerVisible = 0
                    dealerVisible = 0
                    winner = null
                    playerHandName = ""
                    dealerHandName = ""
                    val started = System.currentTimeMillis()
                    val shuffled = listOf('S', 'H', 'D', 'C')
                        .flatMap { suit -> (2..14).map { rank -> PlayingCard(rank, suit) } }
                        .toMutableList()
                    Collections.shuffle(shuffled, SecureRandom())
                    playerCards = shuffled.take(3)
                    dealerCards = shuffled.drop(3).take(3)
                    phase = TeenPattiPhase.BETTING
                    for (remaining in 15 downTo 1) {
                        secondsLeft = remaining
                        delay(1_000)
                    }
                    phase = TeenPattiPhase.DEALING
                    repeat(3) {
                        playerVisible = it + 1
                        delay(550)
                    }
                    repeat(3) {
                        dealerVisible = it + 1
                        delay(550)
                    }
                    playerHandName = handName(playerCards)
                    dealerHandName = handName(dealerCards)
                    val comparison = engine.evaluate(playerCards).compareTo(engine.evaluate(dealerCards))
                    winner = when {
                        comparison > 0 -> "PLAYER"
                        comparison < 0 -> "DEALER"
                        else -> "TIE"
                    }
                    phase = TeenPattiPhase.RESULT
                    val ended = System.currentTimeMillis()
                    val resultText = "Player ${playerCards.joinToString(" ") { it.displayLabel() }} ($playerHandName) · Dealer ${dealerCards.joinToString(" ") { it.displayLabel() }} ($dealerHandName) · $winner"
                    onRoundCompleted(
                        DemoOutcome(
                            gameCode = "teen_patti",
                            roundId = UUID.randomUUID().toString(),
                            result = resultText
                        ),
                        started,
                        ended
                    )
                    delay(6_000)
                    phase = TeenPattiPhase.READY
                    running = false
                }
            }
        ) { Text(if (running) "Round in progress…" else "Deal Teen Patti cards") }
        Text(
            "Hand order: Trail > Pure Sequence > Sequence > Color > Pair > High Card. AKQ is highest sequence; A23 is second-highest. Ties compare rank values. Virtual demo only: no stake, wallet debit, or payout.",
            style = MaterialTheme.typography.bodySmall
        )
    }
}
