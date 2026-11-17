package rw.nexera.nexguard.tracking

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import rw.nexera.nexguard.LostActivity
import rw.nexera.nexguard.MainActivity
import rw.nexera.nexguard.R
import rw.nexera.nexguard.util.DeviceInfo

object Notifications {
    private const val CHANNEL_TRACKING = "tracking"
    private const val CHANNEL_ALERTS = "alerts"
    const val TRACKING_ID = 1
    private const val RINGING_ID = 2
    private const val MESSAGE_ID = 3
    private const val LOST_ID = 4

    fun createChannels(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_TRACKING, ctx.getString(R.string.channel_tracking), NotificationManager.IMPORTANCE_LOW).apply {
                description = ctx.getString(R.string.channel_tracking_desc)
                setShowBadge(false)
            },
        )
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_ALERTS, ctx.getString(R.string.channel_alerts), NotificationManager.IMPORTANCE_HIGH).apply {
                description = ctx.getString(R.string.channel_alerts_desc)
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

    private fun openLostScreen(ctx: Context): PendingIntent = PendingIntent.getActivity(
        ctx,
        1,
        Intent(ctx, LostActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    /** Opens the dialler with the number filled in; the finder still presses Call. */
    fun dial(ctx: Context, phone: String): PendingIntent = PendingIntent.getActivity(
        ctx,
        2,
        Intent(Intent.ACTION_DIAL, Uri.fromParts("tel", phone, null)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    /** The permanent notification while tracking runs. It is never hidden (anti-stalking rule). */
    fun tracking(ctx: Context, lostMode: Boolean, live: Boolean = false): Notification =
        NotificationCompat.Builder(ctx, CHANNEL_TRACKING)
            .setSmallIcon(R.drawable.ic_shield)
            .setContentTitle(
                ctx.getString(
                    when {
                        lostMode -> R.string.notif_tracking_lost
                        live -> R.string.notif_tracking_live
                        else -> R.string.notif_tracking
                    },
                ),
            )
            .setContentText(ctx.getString(if (live) R.string.notif_tracking_live_text else R.string.notif_tracking_text))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(if (lostMode) openLostScreen(ctx) else openApp(ctx))
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
            .setContentTitle(ctx.getString(R.string.notif_alarm))
            .setContentText(ctx.getString(R.string.notif_alarm_text))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .build(),
    )

    fun cancelRinging(ctx: Context) = NotificationManagerCompat.from(ctx).cancel(RINGING_ID)

    fun ownerMessage(ctx: Context, message: String, contactPhone: String?) {
        val text = if (contactPhone.isNullOrBlank()) message else message + "\n" + ctx.getString(R.string.notif_call, contactPhone)
        notify(
            ctx,
            MESSAGE_ID,
            NotificationCompat.Builder(ctx, CHANNEL_ALERTS)
                .setSmallIcon(R.drawable.ic_shield)
                .setContentTitle(ctx.getString(R.string.notif_owner_message))
                .setContentText(message)
                .setStyle(NotificationCompat.BigTextStyle().bigText(text))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setContentIntent(openApp(ctx))
                .build(),
        )
    }

    /** Shown on the lock screen while the phone is marked lost, so an honest finder can return it. */
    fun lost(ctx: Context, message: String?, contactPhone: String?) {
        val body = message?.takeIf { it.isNotBlank() } ?: ctx.getString(R.string.lost_default_message)
        val builder = NotificationCompat.Builder(ctx, CHANNEL_ALERTS)
            .setSmallIcon(R.drawable.ic_shield)
            .setContentTitle(ctx.getString(R.string.lost_title))
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(openLostScreen(ctx))
        if (!contactPhone.isNullOrBlank()) {
            builder.addAction(0, ctx.getString(R.string.lost_call_owner), dial(ctx, contactPhone))
        }
        notify(ctx, LOST_ID, builder.build())
    }

    fun cancelLost(ctx: Context) = NotificationManagerCompat.from(ctx).cancel(LOST_ID)
}
