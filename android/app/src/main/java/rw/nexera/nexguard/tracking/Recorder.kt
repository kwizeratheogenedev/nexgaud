package rw.nexera.nexguard.tracking

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeoutOrNull
import rw.nexera.nexguard.data.LocalDb
import rw.nexera.nexguard.data.PendingPoint
import rw.nexera.nexguard.util.DeviceInfo

/** Saves locations to the local queue; SyncWorker uploads them. */
object Recorder {
    suspend fun save(ctx: Context, location: Location) {
        LocalDb.get(ctx).points().insert(
            PendingPoint(
                lat = location.latitude,
                lng = location.longitude,
                accuracyM = if (location.hasAccuracy()) location.accuracy else null,
                source = "fused",
                battery = DeviceInfo.battery(ctx),
                recordedAt = location.time.takeIf { it > 0 } ?: System.currentTimeMillis(),
            ),
        )
    }

    /** One fresh location, or null if none within 30 seconds or permission is missing. */
    @SuppressLint("MissingPermission") // checked by hasForegroundLocation()
    suspend fun currentLocation(ctx: Context, precise: Boolean): Location? {
        if (!DeviceInfo.hasForegroundLocation(ctx)) return null
        val client = LocationServices.getFusedLocationProviderClient(ctx)
        val priority = if (precise) Priority.PRIORITY_HIGH_ACCURACY else Priority.PRIORITY_BALANCED_POWER_ACCURACY
        val cancel = CancellationTokenSource()
        return try {
            withTimeoutOrNull(30_000) { client.getCurrentLocation(priority, cancel.token).await() }
                ?: client.lastLocation.await()
        } catch (e: Exception) {
            null
        } finally {
            cancel.cancel()
        }
    }
}
