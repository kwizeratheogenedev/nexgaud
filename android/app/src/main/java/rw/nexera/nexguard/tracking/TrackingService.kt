package rw.nexera.nexguard.tracking

import android.annotation.SuppressLint
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import rw.nexera.nexguard.util.DeviceInfo

/**
 * Keeps location updates running while the app is closed or the screen is locked.
 * Normal mode: about every 5 minutes, balanced power. Lost mode: every minute, GPS.
 */
class TrackingService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private lateinit var client: FusedLocationProviderClient
    private var lostMode = false
    private var requesting = false

    private val callback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            scope.launch {
                result.locations.forEach { Recorder.save(applicationContext, it) }
                SyncWorker.enqueue(applicationContext)
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        client = LocationServices.getFusedLocationProviderClient(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!DeviceInfo.hasForegroundLocation(this)) {
            stopSelf()
            return START_NOT_STICKY
        }
        val newLostMode = intent?.getBooleanExtra(EXTRA_LOST_MODE, lostMode) ?: lostMode
        try {
            ServiceCompat.startForeground(
                this,
                Notifications.TRACKING_ID,
                Notifications.tracking(this, newLostMode),
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0,
            )
        } catch (e: Exception) {
            // Android 12+ refuses to start it from the background; WatchdogWorker covers until the app is opened.
            Log.w(TAG, "Could not start in the foreground", e)
            stopSelf()
            return START_NOT_STICKY
        }
        if (!requesting || newLostMode != lostMode) {
            lostMode = newLostMode
            requestUpdates()
        }
        return START_STICKY
    }

    @SuppressLint("MissingPermission") // checked in onStartCommand
    private fun requestUpdates() {
        client.removeLocationUpdates(callback)
        val interval = if (lostMode) LOST_INTERVAL_MS else NORMAL_INTERVAL_MS
        val request = LocationRequest.Builder(
            if (lostMode) Priority.PRIORITY_HIGH_ACCURACY else Priority.PRIORITY_BALANCED_POWER_ACCURACY,
            interval,
        )
            .setMinUpdateIntervalMillis(interval / 2)
            .setMinUpdateDistanceMeters(if (lostMode) 0f else 25f)
            .setMaxUpdateDelayMillis(interval * 2)
            .build()
        client.requestLocationUpdates(request, callback, Looper.getMainLooper())
        requesting = true
    }

    override fun onDestroy() {
        client.removeLocationUpdates(callback)
        scope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val TAG = "TrackingService"
        private const val EXTRA_LOST_MODE = "lost_mode"
        private const val NORMAL_INTERVAL_MS = 5 * 60_000L
        private const val LOST_INTERVAL_MS = 60_000L

        /** Call from the app's own screens or from boot: Android allows a foreground start there. */
        fun start(ctx: Context, lostMode: Boolean) {
            try {
                ContextCompat.startForegroundService(
                    ctx,
                    Intent(ctx, TrackingService::class.java).putExtra(EXTRA_LOST_MODE, lostMode),
                )
            } catch (e: Exception) {
                Log.w(TAG, "Start refused", e)
            }
        }

        fun stop(ctx: Context) {
            ctx.stopService(Intent(ctx, TrackingService::class.java))
        }
    }
}
