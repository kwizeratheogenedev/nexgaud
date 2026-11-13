package rw.nexera.nexguard.tracking

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.util.Log
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.google.android.gms.location.LocationServices
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeoutOrNull
import rw.nexera.nexguard.data.Api
import rw.nexera.nexguard.data.ApiException
import rw.nexera.nexguard.data.EventBody
import rw.nexera.nexguard.data.PointDto
import rw.nexera.nexguard.data.Prefs
import rw.nexera.nexguard.util.DeviceInfo
import java.io.IOException
import java.time.Instant
import java.util.concurrent.TimeUnit

/** Event types the API accepts from the phone. */
object Events {
    const val LOW_BATTERY = "low_battery"
    const val PROTECTION_OFF = "protection_off"
    const val ADMIN_OFF = "admin_off"
    const val PIN_FAILED = "pin_failed"
    const val SHUTDOWN = "shutdown"

    fun Location.toPoint() = PointDto(
        lat = latitude,
        lng = longitude,
        accuracyM = if (hasAccuracy()) accuracy.toDouble() else null,
        source = "fused",
        recordedAt = Instant.ofEpochMilli(time.takeIf { it > 0 } ?: System.currentTimeMillis()).toString(),
    )

    /** The last location Android already knows: instant, no GPS needed. */
    @SuppressLint("MissingPermission") // checked by hasForegroundLocation()
    suspend fun lastKnown(ctx: Context): Location? {
        if (!DeviceInfo.hasForegroundLocation(ctx)) return null
        return runCatching { LocationServices.getFusedLocationProviderClient(ctx).lastLocation.await() }.getOrNull()
    }

    /**
     * Sends an event right away, for moments when there is no time to queue work
     * (stopping protection, switching off). Returns false if it could not be sent in time.
     */
    suspend fun sendNow(ctx: Context, type: String, timeoutMs: Long = 8000, freshLocation: Boolean = false): Boolean {
        val token = Prefs(ctx).snapshot().deviceToken ?: return false
        return withTimeoutOrNull(timeoutMs) {
            val location = if (freshLocation) Recorder.currentLocation(ctx, precise = true) else lastKnown(ctx)
            runCatching { Api.event(token, EventBody(type, DeviceInfo.battery(ctx), location?.toPoint())) }
                .onFailure { Log.w("Events", "Could not send $type", it) }
                .isSuccess
        } ?: false
    }
}

/** Sends one event with a fresh location, retrying until the phone is online. */
class EventWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val ctx = applicationContext
        val type = inputData.getString(KEY_TYPE) ?: return Result.failure()
        val token = Prefs(ctx).snapshot().deviceToken ?: return Result.success()
        val location = Recorder.currentLocation(ctx, precise = true) ?: Events.lastKnown(ctx)
        return try {
            with(Events) {
                Api.event(token, EventBody(type, DeviceInfo.battery(ctx), location?.toPoint()))
            }
            Result.success()
        } catch (e: ApiException) {
            if (e.status >= 500) Result.retry() else Result.failure()
        } catch (e: IOException) {
            Result.retry()
        }
    }

    companion object {
        private const val KEY_TYPE = "type"

        fun report(ctx: Context, type: String) {
            val request = OneTimeWorkRequestBuilder<EventWorker>()
                .setInputData(workDataOf(KEY_TYPE to type))
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(ctx).enqueue(request)
        }
    }
}
