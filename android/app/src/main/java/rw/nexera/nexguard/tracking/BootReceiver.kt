package rw.nexera.nexguard.tracking

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import rw.nexera.nexguard.data.Prefs

/** Restarts protection after a reboot or an app update. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        val pending = goAsync()
        val ctx = context.applicationContext
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val state = Prefs(ctx).snapshot()
                if (state.paired && state.setupDone) {
                    TrackingService.start(ctx, state.lostMode)
                    WatchdogWorker.schedule(ctx)
                    SyncWorker.enqueue(ctx)
                }
            } finally {
                pending.finish()
            }
        }
    }
}
