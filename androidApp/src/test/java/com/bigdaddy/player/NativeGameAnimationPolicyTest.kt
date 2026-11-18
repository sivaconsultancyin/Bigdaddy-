package com.bigdaddy.player

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeGameAnimationPolicyTest {
    @Test
    fun rouletteAnimatesOnlyDuringServerSpin() {
        assertTrue(shouldAnimateNativeGame("roulette", "SPINNING"))
        assertFalse(shouldAnimateNativeGame("roulette", "BETTING"))
        assertFalse(shouldAnimateNativeGame("roulette", "RESULT"))
    }

    @Test
    fun diceAnimatesOnlyDuringServerRoll() {
        assertTrue(shouldAnimateNativeGame("dice", "ROLLING"))
        assertFalse(shouldAnimateNativeGame("dice", "SPINNING"))
        assertFalse(shouldAnimateNativeGame("dice", "SETTLED"))
    }

    @Test
    fun andarBaharAnimatesOnlyDuringServerDeal() {
        assertTrue(shouldAnimateNativeGame("andar_bahar", "DEALING"))
        assertFalse(shouldAnimateNativeGame("andar_bahar", "BETTING"))
        assertFalse(shouldAnimateNativeGame("andar_bahar", "RESULT"))
    }

    @Test
    fun unsupportedGamesNeverAnimate() {
        assertFalse(shouldAnimateNativeGame("dragon_tiger", "DEALING"))
        assertFalse(shouldAnimateNativeGame("teen_patti", "DEALING"))
    }
}
