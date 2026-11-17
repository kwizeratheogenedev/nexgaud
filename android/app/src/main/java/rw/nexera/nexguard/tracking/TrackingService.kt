package rw.nexera.nexguard.tracking

import android.annotation.SuppressLint
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.app.NotificationManager
import android.os.Build
import android.os.Handler
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
 * Live mode (the owner asked, for up to 30 minutes): every 5 seconds, GPS, uploaded at once.
 */
class TrackingService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private lateinit var client: FusedLocationProviderClient
    private var lostMode = false
    private var requesting = false
    private var live = false
    private val main = Handler(Looper.getMainLooper())
    private val liveEnded = Runnable { if (requesting) requestUpdates() }

    private val callback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            scope.launch {
                result.locations.forEach { Recorder.save(applicationContext, it) }
                SyncWorker.enqueue(applicationContext)
            }
        }
    }

    /**
     * Low battery: send the owner the last location before the phone dies (once per low-battery spell).
     * SIM change: sync now, the heartbeat carries the new SIM fingerprint and the API alerts the owner.
     * Android no longer delivers these to receivers declared in the manifest, so the running service listens.
     */
    private val systemEvents = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                Intent.ACTION_BATTERY_LOW -> if (!lowBatteryReported) {
                    lowBatteryReported = true
                    EventWorker.report(applicationContext, Events.LOW_BATTERY)
                }
                Intent.ACTION_BATTERY_OKAY -> lowBatteryReported = false
                ACTION_SIM_STATE_CHANGED -> SyncWorker.enqueue(applicationContext)
            }
        }
    }
    private var lowBatteryReported = false

    override fun onCreate() {
        super.onCreate()
        client = LocationServices.getFusedLocationProviderClient(this)
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_BATTERY_LOW)
            addAction(Intent.ACTION_BATTERY_OKAY)
            addAction(ACTION_SIM_STATE_CHANGED)
        }
        // System broadcasts still reach a not-exported receiver; other apps cannot fake them.
        ContextCompat.registerReceiver(this, systemEvents, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
        // Live tracking switched on or off by the owner (learned at each sync).
        scope.launch {
            LiveMode.untilMs.collect {
                main.post { if (requesting && LiveMode.isLive() != live) requestUpdates() }
            }
        }
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
                Notifications.tracking(this, newLostMode, LiveMode.isLive()),
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
        main.removeCallbacks(liveEnded)
        live = LiveMode.isLive()
        val precise = live || lostMode
        val interval = when {
            live -> LIVE_INTERVAL_MS
            lostMode -> LOST_INTERVAL_MS
            else -> NORMAL_INTERVAL_MS
        }
        val request = LocationRequest.Builder(
            if (precise) Priority.PRIORITY_HIGH_ACCURACY else Priority.PRIORITY_BALANCED_POWER_ACCURACY,
            interval,
        )
            .setMinUpdateIntervalMillis(interval / 2)
            .setMinUpdateDistanceMeters(if (precise) 0f else 25f)
            // Live: deliver each position at once (no batching), so the owner sees it move.
            .setMaxUpdateDelayMillis(if (live) 0 else interval * 2)
            .build()
        client.requestLocationUpdates(request, callback, Looper.getMainLooper())
        requesting = true
        // The notification says when the location is shared live (nobody is tracked without knowing).
        runCatching {
            getSystemService(NotificationManager::class.java)
                .notify(Notifications.TRACKING_ID, Notifications.tracking(this, lostMode, live))
        }
        // Back to the normal rate when live tracking ends, even if no sync happens then.
        if (live) main.postDelayed(liveEnded, LiveMode.untilMs.value - System.currentTimeMillis() + 1000)
    }

    override fun onDestroy() {
        runCatching { unregisterReceiver(systemEvents) }
        client.removeLocationUpdates(callback)
        main.removeCallbacks(liveEnded)
        scope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val TAG = "TrackingService"
        private const val EXTRA_LOST_MODE = "lost_mode"
        // Not in the public SDK constants, but sent by every Android version we support.
        private const val ACTION_SIM_STATE_CHANGED = "android.intent.action.SIM_STATE_CHANGED"
        private const val NORMAL_INTERVAL_MS = 5 * 60_000L
        private const val LOST_INTERVAL_MS = 60_000L
        private const val LIVE_INTERVAL_MS = 5_000L

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
