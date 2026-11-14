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
        listOf("aviator", "dragon_tiger", "dice", "andar_bahar", "roulette", "teen_patti").forEach { code ->
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

    @Test fun dragonTigerTreatsAceAsLowestCard() {
        val engine = DragonTigerEngine()
        assertEquals(1, engine.cardStrength(14))
        assertEquals(13, engine.cardStrength(13))
        assertTrue(engine.cardStrength(13) > engine.cardStrength(14))
    }

    @Test fun teenPattiUsesStandardHandCategoryAndTieBreakers() {
        val engine = TeenPattiEngine()
        val trail = engine.evaluate(listOf(PlayingCard(9, 'S'), PlayingCard(9, 'H'), PlayingCard(9, 'D')))
        val pureSequence = engine.evaluate(listOf(PlayingCard(12, 'S'), PlayingCard(13, 'S'), PlayingCard(14, 'S')))
        val aceTwoThree = engine.evaluate(listOf(PlayingCard(14, 'S'), PlayingCard(2, 'H'), PlayingCard(3, 'D')))
        val kingQueenJack = engine.evaluate(listOf(PlayingCard(13, 'S'), PlayingCard(12, 'H'), PlayingCard(11, 'D')))
        assertTrue(trail > pureSequence)
        assertTrue(aceTwoThree > kingQueenJack)
    }

    @Test fun teenPattiSequenceOrderingMatchesLegacyAKQAndA23Rules() {
        val engine = TeenPattiEngine()
        val akq = engine.evaluate(listOf(PlayingCard(14, 'S'), PlayingCard(13, 'H'), PlayingCard(12, 'D')))
        val a23 = engine.evaluate(listOf(PlayingCard(14, 'S'), PlayingCard(3, 'H'), PlayingCard(2, 'D')))
        val kqj = engine.evaluate(listOf(PlayingCard(13, 'S'), PlayingCard(12, 'H'), PlayingCard(11, 'D')))
        assertTrue(akq > a23)
        assertTrue(a23 > kqj)
    }

    @Test fun teenPattiPureSequenceBeatsNormalSequenceAndFlushBeatsPair() {
        val engine = TeenPattiEngine()
        val pure = engine.evaluate(listOf(PlayingCard(9, 'S'), PlayingCard(10, 'S'), PlayingCard(11, 'S')))
        val sequence = engine.evaluate(listOf(PlayingCard(9, 'S'), PlayingCard(10, 'H'), PlayingCard(11, 'D')))
        val flush = engine.evaluate(listOf(PlayingCard(14, 'S'), PlayingCard(9, 'S'), PlayingCard(4, 'S')))
        val pair = engine.evaluate(listOf(PlayingCard(13, 'S'), PlayingCard(13, 'H'), PlayingCard(2, 'D')))
        assertTrue(pure > sequence)
        assertTrue(flush > pair)
    }

    @Test fun teenPattiRejectsIncompleteAndDuplicateHands() {
        val engine = TeenPattiEngine()
        try {
            engine.evaluate(listOf(PlayingCard(2, 'S'), PlayingCard(3, 'H')))
            throw AssertionError("Expected incomplete hand to be rejected")
        } catch (expected: IllegalArgumentException) {
            assertTrue(expected.message!!.contains("exactly three"))
        }
        try {
            engine.evaluate(listOf(PlayingCard(8, 'S'), PlayingCard(8, 'S'), PlayingCard(4, 'D')))
            throw AssertionError("Expected duplicate card to be rejected")
        } catch (expected: IllegalArgumentException) {
            assertTrue(expected.message!!.contains("duplicate"))
        }
    }

    @Test fun teenPattiPairUsesPairRankThenKicker() {
        val engine = TeenPattiEngine()
        val higherPair = engine.evaluate(listOf(PlayingCard(10, 'S'), PlayingCard(10, 'H'), PlayingCard(2, 'D')))
        val lowerPairWithAceKicker = engine.evaluate(listOf(PlayingCard(9, 'S'), PlayingCard(9, 'H'), PlayingCard(14, 'D')))
        assertTrue(higherPair > lowerPairWithAceKicker)
    }

    @Test fun dragonTigerRejectsInvalidCardRanks() {
        val engine = DragonTigerEngine()
        listOf(1, 15, 0).forEach { rank ->
            try {
                engine.cardStrength(rank)
                throw AssertionError("Expected invalid Dragon Tiger rank to be rejected")
            } catch (expected: IllegalArgumentException) {
                assertTrue(expected.message!!.contains("between 2 and 14"))
            }
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

    @Test fun teenPattiRejectsRanksOutsideStandardDeck() {
        val engine = TeenPattiEngine()
        try {
            engine.evaluate(listOf(PlayingCard(1, 'S'), PlayingCard(8, 'H'), PlayingCard(9, 'D')))
            throw AssertionError("Expected invalid Teen Patti rank to be rejected")
        } catch (expected: IllegalArgumentException) {
            assertTrue(expected.message!!.contains("invalid card"))
        }
    }

    @Test fun dragonTigerAceIsLowestAndEqualRanksTie() {
        val engine = DragonTigerEngine()
        assertEquals("TIGER", engine.winner(14, 2))
        assertEquals("DRAGON", engine.winner(2, 14))
        assertEquals("TIE", engine.winner(10, 10))
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
