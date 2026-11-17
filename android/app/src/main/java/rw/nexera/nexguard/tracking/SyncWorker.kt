package rw.nexera.nexguard.tracking

import android.content.Context
import android.util.Log
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import rw.nexera.nexguard.commands.CommandExecutor
import rw.nexera.nexguard.data.Api
import rw.nexera.nexguard.data.ApiException
import rw.nexera.nexguard.data.CommandDto
import rw.nexera.nexguard.data.LocalDb
import rw.nexera.nexguard.data.Prefs
import rw.nexera.nexguard.util.DeviceInfo
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Uploads queued locations, sends a heartbeat, and runs any commands the owner sent.
 * Runs whenever there is a network connection; retries with backoff when offline.
 */
class SyncWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {

    override suspend fun doWork(): Result {
        val ctx = applicationContext
        val prefs = Prefs(ctx)
        val state = prefs.snapshot()
        val token = state.deviceToken ?: return Result.success()
        val dao = LocalDb.get(ctx).points()

        return try {
            dao.pruneBefore(System.currentTimeMillis() - MAX_QUEUE_AGE_MS)
            val commands = mutableListOf<CommandDto>()

            while (true) {
                val batch = dao.oldest(BATCH_SIZE)
                if (batch.isEmpty()) break
                val res = Api.upload(token, batch.map { it.toDto() })
                dao.delete(batch.map { it.id })
                prefs.setLastUploadAt(System.currentTimeMillis())
                commands += res.commands
                if (batch.size < BATCH_SIZE) break
            }

            val beat = Api.heartbeat(token, DeviceInfo.heartbeat(ctx, state.pushToken))
            commands += beat.commands
            // Live tracking on or off: TrackingService picks this up and changes its rate.
            LiveMode.fromServer(beat.liveUntil)

            val lost = beat.lost
            prefs.setLostMode(lost, beat.lostMode?.message, beat.lostMode?.contactPhone)
            if (lost) {
                Notifications.lost(ctx, beat.lostMode?.message, beat.lostMode?.contactPhone)
            } else if (state.lostMode) {
                Notifications.cancelLost(ctx)
            }
            if (lost != state.lostMode) {
                // Switch the service's update rate. Android may refuse this from the background;
                // the new rate then applies the next time the service or app starts.
                if (state.setupDone) TrackingService.start(ctx, lost)
            }

            val ranLocate = CommandExecutor.runAll(ctx, token, commands.distinctBy { it.id })
            if (ranLocate) enqueue(ctx) // upload the fresh point right away

            Result.success()
        } catch (e: ApiException) {
            if (e.status == 401) {
                // The owner removed this phone from their account.
                Log.w(TAG, "Device token no longer valid; unpairing")
                prefs.clearPairing()
                dao.clear()
                Notifications.cancelLost(ctx)
                TrackingService.stop(ctx)
                WatchdogWorker.cancel(ctx)
                Result.failure()
            } else {
                Log.w(TAG, "API error ${e.status}", e)
                Result.retry()
            }
        } catch (e: IOException) {
            Result.retry()
        }
    }

    companion object {
        private const val TAG = "SyncWorker"
        private const val BATCH_SIZE = 200
        private const val MAX_QUEUE_AGE_MS = 7L * 24 * 3600 * 1000
        private const val UNIQUE_NAME = "nexguard-sync"

        fun enqueue(ctx: Context) {
            val request = OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            // Append so a command push that arrives mid-upload is not dropped.
            WorkManager.getInstance(ctx).enqueueUniqueWork(UNIQUE_NAME, ExistingWorkPolicy.APPEND_OR_REPLACE, request)
        }
    }
}
