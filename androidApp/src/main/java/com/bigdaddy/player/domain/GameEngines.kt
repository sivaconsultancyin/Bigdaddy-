package com.bigdaddy.player.domain

import java.util.UUID
import kotlin.random.Random
import kotlin.math.exp
import kotlin.math.round

data class DemoOutcome(
    val gameCode: String,
    val roundId: String = UUID.randomUUID().toString(),
    val result: String
)

class GameClock(private val nowMillis: () -> Long = { System.nanoTime() / 1_000_000L }) {
    private var startedAt: Long? = null
    fun start() { startedAt = nowMillis() }
    fun elapsedMillis(): Long = startedAt?.let { (nowMillis() - it).coerceAtLeast(0L) } ?: 0L
}

class MultiplierController(private val growthPerSecond: Double = 0.06) {
    fun at(elapsedMillis: Long): Double =
        exp(growthPerSecond * (elapsedMillis.coerceAtLeast(0L) / 1000.0))
}

class CrashStateController(private val crashAt: Double) {
    fun hasCrashed(multiplier: Double): Boolean = multiplier >= crashAt
}

data class AviatorSnapshot(val elapsedMillis: Long, val multiplier: Double, val crashed: Boolean)

class AviatorRoundManager(
    private val clock: GameClock,
    private val multiplier: MultiplierController,
    private val crash: CrashStateController
) {
    fun start() = clock.start()
    fun snapshot(): AviatorSnapshot {
        val elapsed = clock.elapsedMillis()
        val value = multiplier.at(elapsed)
        return AviatorSnapshot(elapsed, value, crash.hasCrashed(value))
    }
}

class FlightAnimationController {
    fun progress(elapsedMillis: Long, durationMillis: Long = 12_000L): Float =
        (elapsedMillis.toFloat() / durationMillis.coerceAtLeast(1L)).coerceIn(0f, 1f)
}

class GameSessionManager {
    private var activeSessionId: String? = null
    @Synchronized fun begin(): String {
        if (activeSessionId == null) activeSessionId = UUID.randomUUID().toString()
        return activeSessionId!!
    }
    @Synchronized fun end() { activeSessionId = null }
    @Synchronized fun current(): String? = activeSessionId
}

data class PlayingCard(val rank: Int, val suit: Char) {
    fun label(): String = "${when (rank) { 1 -> "A"; 11 -> "J"; 12 -> "Q"; 13 -> "K"; else -> rank.toString() }}$suit"
}

private fun deck(): List<PlayingCard> = listOf('S', 'H', 'D', 'C').flatMap { suit ->
    (1..13).map { rank -> PlayingCard(rank, suit) }
}

class DragonTigerEngine {
    internal fun cardStrength(rank: Int): Int = if (rank == 1) 14 else rank

    fun play(seed: Long): DemoOutcome {
        val cards = deck().shuffled(Random(seed)).take(2)
        val dragon = cards[0]
        val tiger = cards[1]
        val winner = when {
            dragon.rank == tiger.rank -> "TIE"
            cardStrength(dragon.rank) > cardStrength(tiger.rank) -> "DRAGON"
            else -> "TIGER"
        }
        return DemoOutcome("dragon_tiger", result = "Dragon ${dragon.label()} · Tiger ${tiger.label()} · $winner")
    }
}

class DiceEngine {
    fun play(seed: Long): DemoOutcome {
        val result = Random(seed).nextInt(10) + 1
        return DemoOutcome("dice", result = "Lucky 10 result: $result")
    }
}

class AndarBaharEngine {
    fun play(seed: Long): DemoOutcome {
        val cards = deck().shuffled(Random(seed))
        val joker = cards.first()
        // Opening side is independent of the joker card's suit.
        val firstSide = if (Random(seed xor 0x5A5A5A5AL).nextBoolean()) "ANDAR" else "BAHAR"
        var winner = firstSide
        var dealt = 0
        for (card in cards.drop(1)) {
            dealt++
            val side = if (dealt % 2 == 1) firstSide else if (firstSide == "ANDAR") "BAHAR" else "ANDAR"
            if (card.rank == joker.rank) { winner = side; break }
        }
        return DemoOutcome("andar_bahar", result = "Joker ${joker.label()} · $winner · $dealt cards")
    }
}

class RouletteEngine {
    private val red = setOf(1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36)
    fun play(seed: Long): DemoOutcome {
        val number = Random(seed).nextInt(37)
        val color = when { number == 0 -> "GREEN"; number in red -> "RED"; else -> "BLACK" }
        return DemoOutcome("roulette", result = "$number · $color")
    }
}

internal data class TeenPattiHandValue(
    val category: Int,
    val tieBreakers: List<Int>
) : Comparable<TeenPattiHandValue> {
    override fun compareTo(other: TeenPattiHandValue): Int {
        if (category != other.category) return category.compareTo(other.category)
        for (index in 0 until minOf(tieBreakers.size, other.tieBreakers.size)) {
            val compared = tieBreakers[index].compareTo(other.tieBreakers[index])
            if (compared != 0) return compared
        }
        return tieBreakers.size.compareTo(other.tieBreakers.size)
    }
}

class TeenPattiEngine {
    internal fun evaluate(cards: List<PlayingCard>): TeenPattiHandValue {
        require(cards.size == 3) { "Teen Patti hands must contain exactly three cards." }
        require(cards.map { it.rank to it.suit }.distinct().size == 3) { "Teen Patti hand cannot contain duplicate cards." }

        val ranks = cards.map { if (it.rank == 1) 14 else it.rank }.sortedDescending()
        val counts = ranks.groupingBy { it }.eachCount().entries
            .sortedWith(compareByDescending<Map.Entry<Int, Int>> { it.value }.thenByDescending { it.key })
        val flush = cards.map { it.suit }.distinct().size == 1
        val ascending = ranks.sorted()
        val aceToKingQueen = ascending == listOf(2, 13, 14)
        val aceTwoThree = ascending == listOf(2, 3, 14)
        val consecutive = ascending[2] - ascending[1] == 1 && ascending[1] - ascending[0] == 1
        val sequenceHigh = when {
            aceToKingQueen -> 15
            aceTwoThree -> 14
            consecutive -> ascending[2]
            else -> null
        }

        return when {
            counts.first().value == 3 -> TeenPattiHandValue(6, listOf(counts.first().key))
            flush && sequenceHigh != null -> TeenPattiHandValue(5, listOf(sequenceHigh))
            sequenceHigh != null -> TeenPattiHandValue(4, listOf(sequenceHigh))
            flush -> TeenPattiHandValue(3, ranks)
            counts.first().value == 2 -> TeenPattiHandValue(2, listOf(counts.first().key, counts.last().key))
            else -> TeenPattiHandValue(1, ranks)
        }
    }

    fun play(seed: Long): DemoOutcome {
        val cards = deck().shuffled(Random(seed))
        val player = cards.take(3)
        val dealer = cards.drop(3).take(3)
        val playerValue = evaluate(player)
        val dealerValue = evaluate(dealer)
        val winner = when {
            playerValue > dealerValue -> "PLAYER"
            playerValue < dealerValue -> "DEALER"
            else -> "TIE"
        }
        return DemoOutcome(
            "teen_patti",
            result = "Player ${player.joinToString(" ") { it.label() }} · Dealer ${dealer.joinToString(" ") { it.label() }} · $winner"
        )
    }
}
class AviatorGameEngine {
    fun createDemoRound(seed: Long): AviatorRoundManager {
        val crashAt = 1.05 + Random(seed).nextDouble() * 24.0
        return AviatorRoundManager(GameClock(), MultiplierController(), CrashStateController(crashAt))
    }

    fun demoCrash(seed: Long): DemoOutcome {
        val crashAt = 1.05 + Random(seed).nextDouble() * 24.0
        val display = round(crashAt * 100.0) / 100.0
        return DemoOutcome("aviator", result = "DEMO CRASH @ ${display}x")
    }
}

class LocalDemoGameRegistry(
    private val aviator: AviatorGameEngine = AviatorGameEngine(),
    private val dragonTiger: DragonTigerEngine = DragonTigerEngine(),
    private val dice: DiceEngine = DiceEngine(),
    private val andarBahar: AndarBaharEngine = AndarBaharEngine(),
    private val roulette: RouletteEngine = RouletteEngine(),
    private val teenPatti: TeenPattiEngine = TeenPattiEngine()
) {
    fun play(gameCode: String, seed: Long = System.nanoTime()): DemoOutcome = when (gameCode) {
        "aviator" -> aviator.demoCrash(seed)
        "dragon_tiger" -> dragonTiger.play(seed)
        "dice" -> dice.play(seed)
        "andar_bahar" -> andarBahar.play(seed)
        "roulette" -> roulette.play(seed)
        "teen_patti" -> teenPatti.play(seed)
        else -> error("Unsupported game: $gameCode")
    }
}
