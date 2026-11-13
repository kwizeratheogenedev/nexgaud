package rw.nexera.nexguard.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import rw.nexera.nexguard.BuildConfig
import java.util.concurrent.TimeUnit

class ApiException(val status: Int, val code: String?, message: String) : Exception(message)

@Serializable data class UserDto(val id: String, val phone: String, val name: String? = null)
@Serializable data class VerifyResponse(val user: UserDto, val accessToken: String, val refreshToken: String, val isNew: Boolean = false)
@Serializable data class DeviceDto(val id: String, val name: String, val status: String = "normal")
@Serializable data class RegisterResponse(val device: DeviceDto, val deviceToken: String)
@Serializable data class CommandDto(
    val id: String,
    val type: String,
    val payload: JsonObject = JsonObject(emptyMap()),
    val status: String = "sent",
)
@Serializable data class PointDto(
    val lat: Double,
    val lng: Double,
    val accuracyM: Double? = null,
    val source: String = "fused",
    val battery: Int? = null,
    val recordedAt: String,
)
@Serializable data class PermissionsDto(
    val location: String,
    val notifications: Boolean,
    val batteryOptimized: Boolean,
    val deviceAdmin: Boolean,
)
@Serializable data class HeartbeatBody(
    val battery: Int? = null,
    val charging: Boolean? = null,
    val network: String? = null,
    val simFingerprint: String? = null,
    val pushToken: String? = null,
    val appVersion: String? = null,
    val osVersion: String? = null,
    val permissions: PermissionsDto? = null,
)
/** What the owner wants shown on this phone's screen while it is marked lost. */
@Serializable data class LostModeDto(val message: String? = null, val contactPhone: String? = null)
@Serializable data class UploadResponse(
    val accepted: Int = 0,
    val rejected: Int = 0,
    val status: String? = null,
    val lostMode: LostModeDto? = null,
    val commands: List<CommandDto> = emptyList(),
)
@Serializable data class HeartbeatResponse(
    val status: String = "normal",
    val lostMode: LostModeDto? = null,
    val commands: List<CommandDto> = emptyList(),
) {
    val lost get() = status == "lost" || status == "stolen"
}
/** Something the owner should hear about: low_battery, protection_off, admin_off, pin_failed, shutdown. */
@Serializable data class EventBody(val type: String, val battery: Int? = null, val location: PointDto? = null)

@Serializable private data class ErrorDto(val error: String? = null, val message: String? = null)
@Serializable private data class PhoneBody(val phone: String)
@Serializable private data class VerifyBody(val phone: String, val code: String, val name: String? = null)
@Serializable private data class RegisterBody(
    val name: String,
    val brand: String? = null,
    val model: String? = null,
    val osVersion: String? = null,
    val appVersion: String? = null,
    val pushToken: String? = null,
)
@Serializable private data class UploadBody(val points: List<PointDto>)
@Serializable private data class AckBody(val status: String, val result: String? = null)

/** The NexGuard REST API. People sign in with a bearer token; the phone uses its device token. */
object Api {
    val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = true
    }
    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()
    private val jsonType = "application/json".toMediaType()

    private suspend fun send(method: String, path: String, body: String?, auth: String?): String =
        withContext(Dispatchers.IO) {
            val builder = Request.Builder().url(BuildConfig.API_BASE_URL + path)
            if (auth != null) builder.header("Authorization", auth)
            val requestBody = when {
                body != null -> body.toRequestBody(jsonType)
                method == "POST" -> "{}".toRequestBody(jsonType)
                else -> null
            }
            builder.method(method, requestBody)
            client.newCall(builder.build()).execute().use { res ->
                val text = res.body?.string().orEmpty()
                if (!res.isSuccessful) {
                    val err = runCatching { json.decodeFromString(ErrorDto.serializer(), text) }.getOrNull()
                    throw ApiException(res.code, err?.error, err?.message ?: "Request failed (${res.code})")
                }
                text
            }
        }

    private fun device(token: String) = "Device $token"

    suspend fun requestCode(phone: String) {
        send("POST", "/auth/otp/request", json.encodeToString(PhoneBody.serializer(), PhoneBody(phone)), null)
    }

    suspend fun verifyCode(phone: String, code: String, name: String?): VerifyResponse {
        val body = json.encodeToString(VerifyBody.serializer(), VerifyBody(phone, code, name?.takeIf { it.isNotBlank() }))
        return json.decodeFromString(VerifyResponse.serializer(), send("POST", "/auth/otp/verify", body, null))
    }

    suspend fun registerDevice(
        accessToken: String,
        name: String,
        brand: String?,
        model: String?,
        osVersion: String?,
        appVersion: String?,
        pushToken: String?,
    ): RegisterResponse {
        val body = json.encodeToString(
            RegisterBody.serializer(),
            RegisterBody(name, brand, model, osVersion, appVersion, pushToken),
        )
        return json.decodeFromString(RegisterResponse.serializer(), send("POST", "/devices", body, "Bearer $accessToken"))
    }

    suspend fun upload(deviceToken: String, points: List<PointDto>): UploadResponse {
        val body = json.encodeToString(UploadBody.serializer(), UploadBody(points))
        return json.decodeFromString(UploadResponse.serializer(), send("POST", "/device/locations", body, device(deviceToken)))
    }

    suspend fun heartbeat(deviceToken: String, body: HeartbeatBody): HeartbeatResponse {
        val text = send("POST", "/device/heartbeat", json.encodeToString(HeartbeatBody.serializer(), body), device(deviceToken))
        return json.decodeFromString(HeartbeatResponse.serializer(), text)
    }

    suspend fun event(deviceToken: String, body: EventBody) {
        send("POST", "/device/events", json.encodeToString(EventBody.serializer(), body), device(deviceToken))
    }

    suspend fun ack(deviceToken: String, commandId: String, done: Boolean, result: String?) {
        val body = json.encodeToString(AckBody.serializer(), AckBody(if (done) "done" else "failed", result?.take(300)))
        send("POST", "/device/commands/$commandId/ack", body, device(deviceToken))
    }
}
