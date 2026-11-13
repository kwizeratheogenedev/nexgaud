package rw.nexera.nexguard.commands

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import kotlinx.coroutines.delay
import rw.nexera.nexguard.tracking.Notifications

object Alarm {
    /**
     * Plays the alarm sound at full alarm volume, even in silent mode, then restores the volume.
     * Uses the alarm stream, which silent mode does not mute.
     */
    suspend fun ring(ctx: Context, seconds: Int) {
        val audio = ctx.getSystemService(AudioManager::class.java)
        val previous = audio.getStreamVolume(AudioManager.STREAM_ALARM)
        // Can fail under Do Not Disturb without notification-policy access; the sound still plays at the set level.
        runCatching { audio.setStreamVolume(AudioManager.STREAM_ALARM, audio.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0) }

        val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
        val player = MediaPlayer().apply {
            setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build(),
            )
            setDataSource(ctx, uri)
            isLooping = true
            prepare()
            start()
        }
        Notifications.ringing(ctx)
        try {
            delay(seconds * 1000L)
        } finally {
            runCatching { player.stop() }
            player.release()
            runCatching { audio.setStreamVolume(AudioManager.STREAM_ALARM, previous, 0) }
            Notifications.cancelRinging(ctx)
        }
    }
}
