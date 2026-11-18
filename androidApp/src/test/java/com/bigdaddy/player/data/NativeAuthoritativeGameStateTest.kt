package com.bigdaddy.player.data

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NativeAuthoritativeGameStateTest {
    @Test
    fun runningRouletteRoundDoesNotExposeAResult() {
        val payload = JSONObject(
            """{"round":{"id":"r-1","roundNumber":4,"status":"SPINNING","winningNumber":17,"color":"red"}}"""
        )

        val state = parseNativeAuthoritativeGameState("roulette", payload)

        assertEquals("SPINNING", state.roundStatus)
        assertNull(state.winningNumber)
        assertNull(state.rouletteColor)
    }

    @Test
    fun rouletteResultIsReadOnlyAndUsesServerNumberAndColor() {
        val payload = JSONObject(
            """{"round":{"id":"r-2","roundNumber":5,"status":"RESULT","winningNumber":0,"color":"green"}}"""
        )

        val state = parseNativeAuthoritativeGameState("roulette", payload)

        assertEquals(0, state.winningNumber)
        assertEquals("green", state.rouletteColor)
    }

    @Test
    fun diceResultIsHiddenUntilTheServerPublishesResult() {
        val running = JSONObject(
            """{"round":{"id":"d-1","roundNumber":8,"status":"ROLLING","rolledNumber":9}}"""
        )
        val settled = JSONObject(
            """{"round":{"id":"d-2","roundNumber":9,"status":"RESULT","rolledNumber":7}}"""
        )

        assertNull(parseNativeAuthoritativeGameState("dice", running).diceNumber)
        assertEquals(7, parseNativeAuthoritativeGameState("dice", settled).diceNumber)
    }

    @Test
    fun andarBaharCardsAreReadOnlyAndAppearOnlyAfterResult() {
        val running = JSONObject(
            """{"round":{"id":"a-1","status":"DEALING","jokerCard":{"code":"AH","rank":14,"suit":"H"},"dealCards":[]}}"""
        )
        val settled = JSONObject(
            """{"round":{"id":"a-2","roundNumber":3,"status":"RESULT","jokerCard":{"code":"AH","rank":14,"suit":"H"},"dealCards":[{"side":"andar","card":{"code":"2S","rank":2,"suit":"S"}},{"side":"bahar","card":{"code":"AD","rank":14,"suit":"D"}}],"winningCard":{"code":"AD","rank":14,"suit":"D"},"winningSide":"bahar"}}"""
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
        val payload = JSONObject(
            """{"gameCode":"dice","status":"COMING_SOON","gameStateUnavailable":true,"round":null,"history":[]}"""
        )

        val state = parseNativeAuthoritativeGameState("dice", payload)

        assertNull(state.roundId)
        assertEquals("COMING_SOON", state.roundStatus)
        assertNull(state.diceNumber)
    }
}
