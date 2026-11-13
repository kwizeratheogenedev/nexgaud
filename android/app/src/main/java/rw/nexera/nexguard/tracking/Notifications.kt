package rw.nexera.nexguard.tracking

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import rw.nexera.nexguard.MainActivity
import rw.nexera.nexguard.R
import rw.nexera.nexguard.util.DeviceInfo

object Notifications {
    private const val CHANNEL_TRACKING = "tracking"
    private const val CHANNEL_ALERTS = "alerts"
    const val TRACKING_ID = 1
    private const val RINGING_ID = 2
    private const val MESSAGE_ID = 3

    fun createChannels(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_TRACKING, "Protection status", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Shows that NexGuard is sharing this phone's location with its owner."
                setShowBadge(false)
            },
        )
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_ALERTS, "Messages from the owner", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Messages and alarms sent from the NexGuard dashboard."
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            },
        )
    }

    private fun openApp(ctx: Context): PendingIntent = PendingIntent.getActivity(
        ctx,
        0,
        Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    /** The permanent notification while tracking runs. It is never hidden (anti-stalking rule). */
    fun tracking(ctx: Context, lostMode: Boolean): Notification =
        NotificationCompat.Builder(ctx, CHANNEL_TRACKING)
            .setSmallIcon(R.drawable.ic_shield)
            .setContentTitle(if (lostMode) "NexGuard: this phone is reported lost" else "NexGuard is protecting this phone")
            .setContentText("Its location is shared with the owner's NexGuard account.")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(openApp(ctx))
            .build()

    @SuppressLint("MissingPermission") // checked by notificationsEnabled()
    private fun notify(ctx: Context, id: Int, notification: Notification) {
        if (DeviceInfo.notificationsEnabled(ctx)) NotificationManagerCompat.from(ctx).notify(id, notification)
    }

    fun ringing(ctx: Context) = notify(
        ctx,
        RINGING_ID,
        NotificationCompat.Builder(ctx, CHANNEL_ALERTS)
            .setSmallIcon(R.drawable.ic_shield)
            .setContentTitle("NexGuard alarm")
            .setContentText("The owner is looking for this phone.")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .build(),
    )

    fun cancelRinging(ctx: Context) = NotificationManagerCompat.from(ctx).cancel(RINGING_ID)

    fun ownerMessage(ctx: Context, message: String, contactPhone: String?) {
        val text = if (contactPhone.isNullOrBlank()) message else "$message\nCall: $contactPhone"
        notify(
            ctx,
            MESSAGE_ID,
            NotificationCompat.Builder(ctx, CHANNEL_ALERTS)
                .setSmallIcon(R.drawable.ic_shield)
                .setContentTitle("Message from this phone's owner")
                .setContentText(message)
                .setStyle(NotificationCompat.BigTextStyle().bigText(text))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setContentIntent(openApp(ctx))
                .build(),
        )
    }
}
