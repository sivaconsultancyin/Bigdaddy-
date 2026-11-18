package com.bigdaddy.player.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NativeAuthoritativeGameStateTest {
    @Test
    fun runningRouletteRoundDoesNotExposeAResult() {
        val payload = mapOf(
            "round" to mapOf(
                "id" to "r-1",
                "roundNumber" to 4,
                "status" to "SPINNING",
                "winningNumber" to 17,
                "color" to "red"
            )
        )

        val state = parseNativeAuthoritativeGameState("roulette", payload)

        assertEquals("SPINNING", state.roundStatus)
        assertNull(state.winningNumber)
        assertNull(state.rouletteColor)
    }

    @Test
    fun rouletteResultUsesServerNumberAndColor() {
        val payload = mapOf(
            "round" to mapOf(
                "id" to "r-2",
                "roundNumber" to 5,
                "status" to "RESULT",
                "winningNumber" to 0,
                "color" to "green"
            )
        )

        val state = parseNativeAuthoritativeGameState("roulette", payload)

        assertEquals(0, state.winningNumber)
        assertEquals("green", state.rouletteColor)
    }

    @Test
    fun diceResultIsHiddenUntilTheServerPublishesResult() {
        val running = mapOf(
            "round" to mapOf("id" to "d-1", "roundNumber" to 8, "status" to "ROLLING", "rolledNumber" to 9)
        )
        val settled = mapOf(
            "round" to mapOf("id" to "d-2", "roundNumber" to 9, "status" to "RESULT", "rolledNumber" to 7)
        )

        assertNull(parseNativeAuthoritativeGameState("dice", running).diceNumber)
        assertEquals(7, parseNativeAuthoritativeGameState("dice", settled).diceNumber)
    }

    @Test
    fun andarBaharCardsAppearOnlyAfterResult() {
        val running = mapOf(
            "round" to mapOf(
                "id" to "a-1",
                "status" to "DEALING",
                "jokerCard" to mapOf("code" to "AH", "rank" to 14, "suit" to "H"),
                "dealCards" to emptyList<Any>()
            )
        )
        val settled = mapOf(
            "round" to mapOf(
                "id" to "a-2",
                "roundNumber" to 3,
                "status" to "RESULT",
                "jokerCard" to mapOf("code" to "AH", "rank" to 14, "suit" to "H"),
                "dealCards" to listOf(
                    mapOf("side" to "andar", "card" to mapOf("code" to "2S", "rank" to 2, "suit" to "S")),
                    mapOf("side" to "bahar", "card" to mapOf("code" to "AD", "rank" to 14, "suit" to "D"))
                ),
                "winningCard" to mapOf("code" to "AD", "rank" to 14, "suit" to "D"),
                "winningSide" to "bahar"
            )
        )

        val hidden = parseNativeAuthoritativeGameState("andar_bahar", running)
        val visible = parseNativeAuthoritativeGameState("andar_bahar", settled)

        assertNull(hidden.jokerCard)
        assertEquals(0, hidden.dealCards.size)
        assertEquals("AH", visible.jokerCard?.code)
        assertEquals("AD", visible.winningCard?.code)
        assertEquals("bahar", visible.winningSide)
        assertEquals(2, visible.dealCards.size)
    }

    @Test
    fun unavailableGameDoesNotInventARound() {
        val payload = mapOf(
            "gameCode" to "dice",
            "status" to "COMING_SOON",
            "gameStateUnavailable" to true,
            "round" to null,
            "history" to emptyList<Any>()
        )

        val state = parseNativeAuthoritativeGameState("dice", payload)

        assertNull(state.roundId)
        assertEquals("COMING_SOON", state.roundStatus)
        assertNull(state.diceNumber)
    }
}
