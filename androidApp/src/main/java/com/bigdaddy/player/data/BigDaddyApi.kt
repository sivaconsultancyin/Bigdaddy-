package com.bigdaddy.player.data

import com.bigdaddy.player.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

data class NativeAccount(val id: String, val username: String, val role: String)
data class NativeLoginResult(val token: String, val account: NativeAccount, val walletBalance: String?)

data class NativeAviatorRound(
    val id: String,
    val roundNumber: Int,
    val status: String,
    val multiplier: Double,
    val crashMultiplier: Double?,
    val startedAt: String?
)

data class NativeAviatorHistoryItem(
    val roundNumber: Int,
    val crashMultiplier: Double
)

data class NativeAviatorState(
    val round: NativeAviatorRound?,
    val history: List<NativeAviatorHistoryItem>,
    val serverTime: String?
)

data class NativeGameCard(
    val code: String,
    val rank: Int,
    val suit: String,
    val side: String?
)

data class NativeGameHistoryItem(
    val roundNumber: Int,
    val summary: String
)

data class NativeAuthoritativeGameState(
    val gameCode: String,
    val roundId: String?,
    val roundNumber: Int,
    val roundStatus: String,
    val bettingEndsAt: Long?,
    val totalBetsCount: Int,
    val totalBetAmount: String,
    val winningNumber: Int?,
    val rouletteColor: String?,
    val diceNumber: Int?,
    val jokerCard: NativeGameCard?,
    val winningCard: NativeGameCard?,
    val winningSide: String?,
    val dealCards: List<NativeGameCard>,
    val history: List<NativeGameHistoryItem>
)

private fun readGameCard(card: JSONObject?, side: String? = null): NativeGameCard? {
    if (card == null) return null
    val code = card.optString("code").trim()
    if (code.isBlank() || code == "null") return null
    return NativeGameCard(
        code = code,
        rank = card.optInt("rank", 0),
        suit = card.optString("suit").uppercase(),
        side = side
    )
}

private fun summarizeNativeGameHistory(gameCode: String, result: JSONObject?): String? {
    if (result == null) return null
    return when (gameCode) {
        "roulette" -> {
            val number = result.optInt("number", Int.MIN_VALUE)
            if (number == Int.MIN_VALUE) null else "$number · ${result.optString("color").uppercase()}"
        }
        "dice" -> {
            val number = result.optInt("number", Int.MIN_VALUE)
            if (number == Int.MIN_VALUE) null else "Lucky 10: $number"
        }
        "andar_bahar" -> {
            val winner = result.optString("winner").takeIf { it.isNotBlank() && it != "null" }
            val count = result.optInt("totalCardsDealt", 0)
            winner?.let { "${it.uppercase()} · $count cards" }
        }
        else -> null
    }
}

/**
 * Defensive client parser for the Node authoritative-games route.
 * Result-bearing fields are ignored until the server publishes RESULT/SETTLED.
 */
internal fun parseNativeAuthoritativeGameState(
    requestedGameCode: String,
    response: JSONObject
): NativeAuthoritativeGameState {
    val code = requestedGameCode.trim().lowercase().replace('-', '_')
    require(code in setOf("roulette", "dice", "andar_bahar")) { "Unsupported authoritative game: $code" }
    val round = response.optJSONObject("round")
    val status = (round?.optString("status") ?: response.optString("status", "UNKNOWN")).uppercase()
    val resultReady = status == "RESULT" || status == "SETTLED"

    val dealCards = mutableListOf<NativeGameCard>()
    if (resultReady) {
        val cards = round?.optJSONArray("dealCards")
        if (cards != null) {
            for (index in 0 until cards.length()) {
                val entry = cards.optJSONObject(index) ?: continue
                readGameCard(entry.optJSONObject("card"), entry.optString("side"))?.let(dealCards::add)
            }
        }
    }

    val history = mutableListOf<NativeGameHistoryItem>()
    val historyJson = response.optJSONArray("history")
    if (historyJson != null) {
        for (index in 0 until historyJson.length()) {
            val item = historyJson.optJSONObject(index) ?: continue
            val summary = summarizeNativeGameHistory(code, item.optJSONObject("result")) ?: continue
            history += NativeGameHistoryItem(
                roundNumber = item.optInt("roundNumber", 0),
                summary = summary
            )
        }
    }

    return NativeAuthoritativeGameState(
        gameCode = code,
        roundId = round?.optString("id")?.takeIf { it.isNotBlank() && it != "null" },
        roundNumber = round?.optInt("roundNumber", 0) ?: 0,
        roundStatus = status,
        bettingEndsAt = round?.optLong("bettingEndsAt")?.takeIf { it > 0L },
        totalBetsCount = round?.optInt("totalBetsCount", 0) ?: 0,
        totalBetAmount = round?.optString("totalBetAmount", "0") ?: "0",
        winningNumber = if (resultReady && code == "roulette" && round?.has("winningNumber") == true && !round.isNull("winningNumber")) {
            round.optInt("winningNumber")
        } else null,
        rouletteColor = if (resultReady && code == "roulette") {
            round?.optString("color")?.takeIf { it.isNotBlank() && it != "null" }?.lowercase()
        } else null,
        diceNumber = if (resultReady && code == "dice" && round?.has("rolledNumber") == true && !round.isNull("rolledNumber")) {
            round.optInt("rolledNumber")
        } else null,
        jokerCard = if (resultReady && code == "andar_bahar") readGameCard(round?.optJSONObject("jokerCard")) else null,
        winningCard = if (resultReady && code == "andar_bahar") readGameCard(round?.optJSONObject("winningCard")) else null,
        winningSide = if (resultReady && code == "andar_bahar") {
            round?.optString("winningSide")?.takeIf { it.isNotBlank() && it != "null" }
        } else null,
        dealCards = dealCards,
        history = history
    )
}

data class NativeGameCatalogItem(
    val id: String,
    val code: String,
    val name: String,
    val status: String,
    val minBet: String,
    val maxBet: String,
    val poolBalance: String,
    val description: String
)

class BigDaddyApi {
    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .callTimeout(25, TimeUnit.SECONDS)
        .build()
    private val baseUrl = BuildConfig.SUPABASE_URL.trimEnd('/') + "/functions/v1/api"
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    private fun request(path: String, token: String? = null, body: JSONObject? = null): Request {
        require(BuildConfig.SUPABASE_URL.startsWith("https://")) {
            "Native app is not configured. Supply SUPABASE_URL through the build environment."
        }
        require(BuildConfig.SUPABASE_PUBLISHABLE_KEY.isNotBlank()) {
            "Native app is not configured. Supply SUPABASE_PUBLISHABLE_KEY through the build environment."
        }
        val builder = Request.Builder().url(baseUrl + path)
            .header("Accept", "application/json")
            .header("apikey", BuildConfig.SUPABASE_PUBLISHABLE_KEY)
        if (!token.isNullOrBlank()) builder.header("Authorization", "Bearer $token")
        return if (body != null) {
            builder.post(body.toString().toRequestBody(jsonType)).header("Content-Type", "application/json").build()
        } else builder.get().build()
    }

    private fun backendRequest(path: String, token: String? = null): Request {
        val backendUrl = BuildConfig.BIGDADDY_BACKEND_URL.trimEnd('/')
        require(backendUrl.startsWith("https://")) {
            "Native game server is not configured. Supply BIGDADDY_BACKEND_URL for the Node.js backend."
        }
        val apiRoot = if (backendUrl.endsWith("/api")) backendUrl else "$backendUrl/api"
        val builder = Request.Builder().url(apiRoot + path).header("Accept", "application/json")
        if (!token.isNullOrBlank()) builder.header("Authorization", "Bearer $token")
        return builder.get().build()
    }

    private suspend fun execute(request: Request): JSONObject = withContext(Dispatchers.IO) {
        client.newCall(request).execute().use { response ->
            val raw = response.body?.string().orEmpty()
            val parsed = runCatching { if (raw.isBlank()) JSONObject() else JSONObject(raw) }.getOrElse { JSONObject() }
            if (!response.isSuccessful) {
                val serverMessage = parsed.optString(
                    "error",
                    parsed.optString("message", raw.take(240).ifBlank { "Request failed" })
                )
                // Keep auth failures machine-detectable by the session restore flow.
                val code = when (response.code) {
                    401 -> "AUTH_REQUIRED"
                    403 -> "TOKEN_ROLE_STALE"
                    404 -> "USER_NOT_FOUND_OR_DISABLED"
                    else -> "HTTP_${response.code}"
                }
                throw IllegalStateException("$code: $serverMessage")
            }
            parsed
        }
    }

    suspend fun login(username: String, password: String): NativeLoginResult {
        val payload = JSONObject().put("username", username.trim()).put("password", password)
        val response = execute(request("/auth/login", body = payload))
        val token = response.optString("token")
        val user = response.optJSONObject("user") ?: JSONObject()
        require(token.isNotBlank() && user.optString("id").isNotBlank()) {
            "The authentication service returned an incomplete login response."
        }
        val wallet = response.optJSONObject("wallet")
        return NativeLoginResult(
            token = token,
            account = NativeAccount(user.optString("id"), user.optString("username"), user.optString("role")),
            walletBalance = wallet?.optString("balance")
        )
    }

    suspend fun verifySession(token: String): NativeAccount {
        val response = execute(request("/auth/me", token))
        val user = response.optJSONObject("user") ?: throw IllegalStateException("Session response did not contain a user.")
        val account = NativeAccount(user.optString("id"), user.optString("username"), user.optString("role"))
        require(account.id.isNotBlank() && account.username.isNotBlank()) {
            "The authentication service returned an incomplete account."
        }
        require(account.role.equals("PLAYER", ignoreCase = true)) {
            "This app is for Player accounts only. Please sign in with a Player account."
        }
        return account
    }


    suspend fun registerReferral(username: String, email: String, password: String, referralCode: String) {
        val payload = JSONObject()
            .put("username", username.trim())
            .put("email", email.trim())
            .put("password", password)
            .put("referralCode", referralCode.trim().uppercase())
        execute(request("/auth/register-referral", body = payload))
    }

    suspend fun walletBalance(token: String): String {
        val response = execute(request("/wallet/my-wallet", token))
        val wallet = response.optJSONObject("wallet") ?: return "0"
        return wallet.optString("balance", "0")
    }

    /**
     * Reads the same authenticated game catalog used by the Website Player dashboard.
     * Missing pool metadata is represented as zero, matching the current Edge API response.
     */
    suspend fun gameCatalog(token: String): List<NativeGameCatalogItem> {
        val response = execute(request("/games/list", token))
        val items = response.optJSONArray("games") ?: return emptyList()
        val catalog = mutableListOf<NativeGameCatalogItem>()
        for (index in 0 until items.length()) {
            val item = items.optJSONObject(index) ?: continue
            val code = item.optString("code").trim().lowercase().replace('-', '_')
            if (code.isBlank()) continue
            fun readValue(vararg keys: String): String {
                for (key in keys) {
                    val value = item.optString(key).trim()
                    if (value.isNotBlank() && value != "null") return value
                }
                return ""
            }
            catalog += NativeGameCatalogItem(
                id = readValue("id").ifBlank { code },
                code = code,
                name = readValue("name").ifBlank { code.replace('_', ' ').replaceFirstChar { it.uppercase() } },
                status = readValue("status").ifBlank { "COMING_SOON" }.uppercase(),
                minBet = readValue("min_bet", "minBet"),
                maxBet = readValue("max_bet", "maxBet"),
                poolBalance = readValue("poolBalance", "pool_balance").ifBlank { "0" },
                description = readValue("description")
            )
        }
        return catalog
    }


    /**
     * Reads a persistent Node-authoritative round for Roulette, Dice or Andar Bahar.
     * This call is GET-only: it never places bets or creates/settles a result.
     */
    suspend fun authoritativeGameState(token: String, gameCode: String): NativeAuthoritativeGameState {
        val code = gameCode.trim().lowercase().replace('-', '_')
        require(code in setOf("roulette", "dice", "andar_bahar")) { "Unsupported authoritative game: $code" }
        val response = execute(backendRequest("/games/$code/state", token))
        return parseNativeAuthoritativeGameState(code, response)
    }


    /**
     * Reads the server-authoritative Aviator round bundle from the configured Node API.
     * This method never creates a round, multiplier, crash result, bet or payout.
     */
    suspend fun aviatorState(token: String): NativeAviatorState {
        val response = execute(backendRequest("/games/aviator/state", token))
        val roundJson = response.optJSONObject("round")
        val round = if (roundJson == null || roundJson.optString("id").isBlank()) {
            null
        } else {
            val rawMultiplier = roundJson.optDouble("multiplier", 1.0)
            val rawCrashMultiplier = if (roundJson.isNull("crashMultiplier")) {
                null
            } else {
                roundJson.optDouble("crashMultiplier", Double.NaN).takeIf { it.isFinite() && it >= 1.0 }
            }
            NativeAviatorRound(
                id = roundJson.optString("id"),
                roundNumber = roundJson.optInt("roundNumber", 0),
                status = roundJson.optString("status", "WAITING").uppercase(),
                multiplier = rawMultiplier.takeIf { it.isFinite() && it >= 1.0 } ?: 1.0,
                crashMultiplier = rawCrashMultiplier,
                startedAt = roundJson.optString("startedAt").takeIf { it.isNotBlank() && it != "null" }
            )
        }
        val historyJson = response.optJSONArray("history")
        val history = mutableListOf<NativeAviatorHistoryItem>()
        if (historyJson != null) {
            for (index in 0 until historyJson.length()) {
                val item = historyJson.optJSONObject(index) ?: continue
                val crash = item.optDouble("crashMultiplier", Double.NaN)
                if (crash.isFinite() && crash >= 1.0) {
                    history += NativeAviatorHistoryItem(
                        roundNumber = item.optInt("roundNumber", 0),
                        crashMultiplier = crash
                    )
                }
            }
        }
        return NativeAviatorState(
            round = round,
            history = history,
            serverTime = response.optString("serverTime").takeIf { it.isNotBlank() && it != "null" }
        )
    }
}
