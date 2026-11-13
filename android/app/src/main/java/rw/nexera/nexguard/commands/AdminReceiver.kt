package rw.nexera.nexguard.commands

import android.app.admin.DeviceAdminReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import rw.nexera.nexguard.R
import rw.nexera.nexguard.tracking.EventWorker
import rw.nexera.nexguard.tracking.Events

/**
 * Device admin with only the "force lock" policy, so the owner can lock the screen remotely.
 * Turning it off (needed before NexGuard can be uninstalled) alerts the owner.
 */
class AdminReceiver : DeviceAdminReceiver() {
    override fun onDisableRequested(context: Context, intent: Intent): CharSequence =
        context.getString(R.string.admin_disable_warning)

    override fun onDisabled(context: Context, intent: Intent) {
        EventWorker.report(context.applicationContext, Events.ADMIN_OFF)
    }

    companion object {
        fun component(ctx: Context) = ComponentName(ctx, AdminReceiver::class.java)
    }
}
