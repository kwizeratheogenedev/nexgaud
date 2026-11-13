package rw.nexera.nexguard.tracking

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import rw.nexera.nexguard.data.Prefs
import rw.nexera.nexguard.util.DeviceInfo
import java.util.concurrent.TimeUnit

/**
 * Backup for phones whose maker kills the tracking service: every 15 minutes (Android's
 * minimum) it records one location and syncs. Needs "Allow all the time" to work in the background.
 */
class WatchdogWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val ctx = applicationContext
        val state = Prefs(ctx).snapshot()
        if (!state.paired || !state.setupDone) return Result.success()
        if (DeviceInfo.hasBackgroundLocation(ctx)) {
            Recorder.currentLocation(ctx, precise = state.lostMode)?.let { Recorder.save(ctx, it) }
        }
        SyncWorker.enqueue(ctx)
        return Result.success()
    }

    companion object {
        private const val UNIQUE_NAME = "nexguard-watchdog"

        fun schedule(ctx: Context) {
            val request = PeriodicWorkRequestBuilder<WatchdogWorker>(15, TimeUnit.MINUTES).build()
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(UNIQUE_NAME, ExistingPeriodicWorkPolicy.KEEP, request)
        }

        fun cancel(ctx: Context) {
            WorkManager.getInstance(ctx).cancelUniqueWork(UNIQUE_NAME)
        }
    }
}
