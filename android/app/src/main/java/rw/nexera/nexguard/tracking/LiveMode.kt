package rw.nexera.nexguard.tracking

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.time.Instant

/**
 * Live tracking, asked for by the owner in the dashboard: until [untilMs] the phone sends its GPS position
 * every few seconds. The API tells the phone in every reply (liveUntil); it always ends by itself.
 * TrackingService watches this and changes its update rate; no new service start is needed (Android
 * refuses those from the background).
 */
object LiveMode {
    private val until = MutableStateFlow(0L)
    val untilMs: StateFlow<Long> = until

    /** From the API's reply: an ISO time, or null when live tracking is off. */
    fun fromServer(iso: String?) {
        until.value = iso?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() } ?: 0L
    }

    fun isLive(now: Long = System.currentTimeMillis()) = until.value > now
}
