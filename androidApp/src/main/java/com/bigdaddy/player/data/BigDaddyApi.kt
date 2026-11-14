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
data class AviatorRoundState(val id: String, val roundNumber: Long, val status: String, val multiplier: Double, val crashMultiplier: Double?, val startedAt: String?)

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

    private suspend fun execute(request: Request): JSONObject = withContext(Dispatchers.IO) {
        require(BuildConfig.SUPABASE_URL.startsWith("https://")) {
            "Native app is not configured. Supply SUPABASE_URL through the build environment."
        }
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


    suspend fun aviatorState(token: String): AviatorRoundState? {
        val response = execute(request("/games/aviator/state", token))
        val round = response.optJSONObject("round") ?: return null
        val id = round.optString("id")
        if (id.isBlank()) throw IllegalStateException("Aviator state returned an invalid round.")
        return AviatorRoundState(
            id = id,
            roundNumber = round.optLong("roundNumber"),
            status = round.optString("status", "UNKNOWN"),
            multiplier = round.optDouble("multiplier", 1.0),
            crashMultiplier = if (round.isNull("crashMultiplier")) null else round.optDouble("crashMultiplier"),
            startedAt = round.optString("startedAt").takeIf { it.isNotBlank() && it != "null" }
        )
    }

    suspend fun walletBalance(token: String): String {
        val response = execute(request("/wallet/my-wallet", token))
        val wallet = response.optJSONObject("wallet") ?: return "0"
        return wallet.optString("balance", "0")
    }
}
