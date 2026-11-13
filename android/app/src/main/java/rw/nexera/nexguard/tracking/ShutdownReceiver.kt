package rw.nexera.nexguard.tracking

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import rw.nexera.nexguard.data.Prefs

/**
 * Thieves often switch a phone off at once. When it shuts down, send the owner the last
 * known location. Android gives only a few seconds, so this is best effort.
 */
class ShutdownReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action !in ACTIONS) return
        val pending = goAsync()
        val ctx = context.applicationContext
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val state = Prefs(ctx).snapshot()
                if (state.paired && state.setupDone) Events.sendNow(ctx, Events.SHUTDOWN, timeoutMs = 7000)
            } finally {
                pending.finish()
            }
        }
    }

    companion object {
        // QUICKBOOT_POWEROFF is sent instead of SHUTDOWN by some phone makers.
        private val ACTIONS = setOf(Intent.ACTION_SHUTDOWN, "android.intent.action.QUICKBOOT_POWEROFF")
    }
}
