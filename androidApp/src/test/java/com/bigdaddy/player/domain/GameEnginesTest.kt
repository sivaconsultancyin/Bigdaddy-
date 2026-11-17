package com.bigdaddy.player.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class GameEnginesTest {
    @Test fun aviatorMultiplierIsMonotonic() {
        val controller = MultiplierController()
        assertTrue(controller.at(2_000) > controller.at(1_000))
        assertEquals(1.0, controller.at(0), 0.0001)
    }

    @Test fun flightProgressIsClamped() {
        val controller = FlightAnimationController()
        assertEquals(0f, controller.progress(-100))
        assertEquals(1f, controller.progress(20_000))
    }

    @Test fun aviatorMultiplierProgressIsMonotonicAndClamped() {
        val controller = FlightAnimationController()
        assertEquals(0f, controller.multiplierProgress(1.0))
        assertTrue(controller.multiplierProgress(2.0) > controller.multiplierProgress(1.5))
        assertEquals(1f, controller.multiplierProgress(100.0))
        assertEquals(0f, controller.multiplierProgress(0.5))
    }

    @Test fun crashControllerUsesSameMultiplierValue() {
        val controller = CrashStateController(2.0)
        assertTrue(!controller.hasCrashed(1.99))
        assertTrue(controller.hasCrashed(2.0))
    }

    @Test fun allLocalGamesAreDeterministicForSameSeed() {
        val registry = LocalDemoGameRegistry()
        listOf("aviator", "dice", "andar_bahar", "roulette").forEach { code ->
            assertEquals(registry.play(code, 42L).result, registry.play(code, 42L).result)
        }
    }

    @Test fun luckyTenResultAlwaysFallsWithinOneToTen() {
        val engine = DiceEngine()
        repeat(500) { seed ->
            val value = engine.play(seed.toLong()).result.substringAfter(": ").toInt()
            assertTrue(value in 1..10)
        }
    }

    @Test fun andarBaharRejectsDuplicateCardsInDeck() {
        val engine = AndarBaharEngine()
        try {
            engine.dealSequence(listOf(
                PlayingCard(8, 'S'),
                PlayingCard(2, 'H'),
                PlayingCard(2, 'H'),
                PlayingCard(8, 'C')
            ))
            throw AssertionError("Expected duplicate Andar Bahar cards to be rejected")
        } catch (expected: IllegalArgumentException) {
            assertTrue(expected.message!!.contains("duplicate"))
        }
    }

    @Test fun andarBaharFirstSideUsesJokerSuitColor() {
        val engine = AndarBaharEngine()
        assertEquals("ANDAR", engine.openingSide('S'))
        assertEquals("ANDAR", engine.openingSide('C'))
        assertEquals("BAHAR", engine.openingSide('H'))
        assertEquals("BAHAR", engine.openingSide('D'))
    }

    @Test fun andarBaharDealsAlternateUntilFirstJokerRankMatch() {
        val engine = AndarBaharEngine()
        val deck = listOf(
            PlayingCard(8, 'S'),
            PlayingCard(2, 'H'),
            PlayingCard(3, 'D'),
            PlayingCard(8, 'C'),
            PlayingCard(4, 'S')
        )
        val sequence = engine.dealSequence(deck)
        assertEquals(3, sequence.size)
        assertEquals(listOf("ANDAR", "BAHAR", "ANDAR"), sequence.map { it.side })
        assertEquals(listOf(2, 3, 8), sequence.map { it.card.rank })
        assertEquals(8, sequence.last().card.rank)
    }

    @Test fun andarBaharRejectsDeckWithoutMatchingJokerRank() {
        val engine = AndarBaharEngine()
        try {
            engine.dealSequence(listOf(PlayingCard(8, 'S'), PlayingCard(2, 'H'), PlayingCard(3, 'D')))
            throw AssertionError("Expected missing matching rank to be rejected")
        } catch (expected: IllegalArgumentException) {
            assertTrue(expected.message!!.contains("matching rank"))
        }
    }

    @Test fun diceMarketsUseLegacyPayoutRules() {
        val engine = DiceEngine()
        assertEquals(9, engine.payoutMultiplier("7", 7))
        assertEquals(0, engine.payoutMultiplier("7", 8))
        assertEquals(2, engine.payoutMultiplier("small", 5))
        assertEquals(2, engine.payoutMultiplier("big", 10))
        assertEquals(2, engine.payoutMultiplier("even", 8))
        assertEquals(2, engine.payoutMultiplier("odd", 9))
        assertEquals(0, engine.payoutMultiplier("invalid", 5))
    }

    @Test fun diceMarketsRejectResultsOutsideTheLegalOneToTenRange() {
        val engine = DiceEngine()
        listOf(-1, 0, 11, 12, 100).forEach { rolled ->
            listOf("1", "small", "big", "even", "odd").forEach { market ->
                assertEquals("market=$market rolled=$rolled", 0, engine.payoutMultiplier(market, rolled))
            }
        }
    }

    @Test fun rouletteZeroCannotWinOutsideZeroNumberCombinations() {
        val engine = RouletteEngine()
        listOf("red", "black", "even", "odd", "low", "high", "dozen1", "dozen2", "dozen3", "col1", "col2", "col3", "line")
            .forEach { market -> assertTrue("market=$market", !engine.wins(market, listOf(0), 0)) }
        assertTrue(engine.wins("straight", listOf(0), 0))
        assertTrue(engine.wins("split", listOf(0, 1), 0))
    }

    @Test fun rouletteRejectsNumbersOutsideTheEuropeanWheel() {
        val engine = RouletteEngine()
        listOf(-1, 37, 100).forEach { number ->
            assertEquals("INVALID", engine.color(number))
            assertTrue(!engine.wins("straight", listOf(number), number))
            assertTrue(!engine.wins("red", emptyList(), number))
        }
    }

    @Test fun rouletteMarketsUseSingleZeroWheelRules() {
        val engine = RouletteEngine()
        assertEquals("GREEN", engine.color(0))
        assertEquals("RED", engine.color(1))
        assertEquals("BLACK", engine.color(2))
        assertTrue(engine.wins("red", emptyList(), 1))
        assertTrue(!engine.wins("red", emptyList(), 0))
        assertTrue(engine.wins("straight", listOf(0), 0))
        assertEquals(36, engine.payoutMultiplier("straight"))
        assertEquals(2, engine.payoutMultiplier("red"))
    }

    @Test fun gameClockUsesInjectedMonotonicSource() {
        var now = 100L
        val clock = GameClock { now }
        clock.start()
        now = 375L
        assertEquals(275L, clock.elapsedMillis())
    }

    @Test fun gameSessionManagerKeepsOneSessionUntilEnded() {
        val manager = GameSessionManager()
        assertEquals(manager.begin(), manager.begin())
        manager.end()
        assertTrue(manager.current() == null)
    }
}
