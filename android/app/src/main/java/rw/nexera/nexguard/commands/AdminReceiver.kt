package rw.nexera.nexguard.commands

import android.app.admin.DeviceAdminReceiver
import android.content.ComponentName
import android.content.Context

/** Device admin with only the "force lock" policy, so the owner can lock the screen remotely. */
class AdminReceiver : DeviceAdminReceiver() {
    companion object {
        fun component(ctx: Context) = ComponentName(ctx, AdminReceiver::class.java)
    }
}
