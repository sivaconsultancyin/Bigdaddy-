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
     * Reads the authenticated, server-authoritative Aviator round bundle.
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
