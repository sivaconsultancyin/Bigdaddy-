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

    @Test fun dragonTigerTreatsAceAsHighestCard() {
        val engine = DragonTigerEngine()
        assertEquals(1, engine.cardStrength(14))
        assertEquals(13, engine.cardStrength(13))
        assertTrue(engine.cardStrength(13) > engine.cardStrength(14))
    }

    @Test fun teenPattiUsesStandardHandCategoryAndTieBreakers() {
        val engine = TeenPattiEngine()
        val trail = engine.evaluate(listOf(PlayingCard(9, 'S'), PlayingCard(9, 'H'), PlayingCard(9, 'D')))
        val pureSequence = engine.evaluate(listOf(PlayingCard(12, 'S'), PlayingCard(13, 'S'), PlayingCard(14, 'S')))
        val aceTwoThree = engine.evaluate(listOf(PlayingCard(1, 'S'), PlayingCard(2, 'H'), PlayingCard(3, 'D')))
        val kingQueenJack = engine.evaluate(listOf(PlayingCard(13, 'S'), PlayingCard(12, 'H'), PlayingCard(11, 'D')))
        assertTrue(trail > pureSequence)
        assertTrue(aceTwoThree > kingQueenJack)
    }

    @Test fun andarBaharOpeningSideFollowsJokerColor() {
        val engine = AndarBaharEngine()
        val blackJoker = engine.play(3L).result
        val redJoker = engine.play(4L).result
        assertTrue(blackJoker.contains("ANDAR") || blackJoker.contains("BAHAR"))
        assertTrue(redJoker.contains("ANDAR") || redJoker.contains("BAHAR"))
    }

    @Test fun teenPattiPairUsesPairRankThenKicker() {
        val engine = TeenPattiEngine()
        val higherPair = engine.evaluate(listOf(PlayingCard(10, 'S'), PlayingCard(10, 'H'), PlayingCard(2, 'D')))
        val lowerPairWithAceKicker = engine.evaluate(listOf(PlayingCard(9, 'S'), PlayingCard(9, 'H'), PlayingCard(14, 'D')))
        assertTrue(higherPair > lowerPairWithAceKicker)
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
