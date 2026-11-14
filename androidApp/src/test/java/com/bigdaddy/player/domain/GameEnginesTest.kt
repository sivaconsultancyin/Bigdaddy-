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
