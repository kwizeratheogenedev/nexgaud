package rw.nexera.nexguard.commands

import android.app.admin.DevicePolicyManager
import android.content.Context
import android.util.Log
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import rw.nexera.nexguard.data.Api
import rw.nexera.nexguard.data.CommandDto
import rw.nexera.nexguard.tracking.Notifications
import rw.nexera.nexguard.tracking.Recorder
import kotlin.math.roundToInt

/** Runs commands from the owner's dashboard and reports each result back. */
object CommandExecutor {
    private const val TAG = "CommandExecutor"

    /** Returns true when a "locate" ran, so the caller uploads the fresh point. */
    suspend fun runAll(ctx: Context, deviceToken: String, commands: List<CommandDto>): Boolean {
        var located = false
        for (command in commands) {
            val (ok, result) = try {
                run(ctx, command)
            } catch (e: Exception) {
                Log.w(TAG, "Command ${command.type} failed", e)
                false to (e.message ?: "Error on the phone")
            }
            if (command.type == "locate" && ok) located = true
            runCatching { Api.ack(deviceToken, command.id, ok, result) }
                .onFailure { Log.w(TAG, "Could not report result of ${command.id}", it) }
        }
        return located
    }

    private fun text(command: CommandDto, key: String): String? =
        command.payload[key]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() }

    private suspend fun run(ctx: Context, command: CommandDto): Pair<Boolean, String> = when (command.type) {
        "ring" -> {
            val seconds = (command.payload["durationSec"]?.jsonPrimitive?.intOrNull ?: 30).coerceIn(5, 120)
            Alarm.ring(ctx, seconds)
            true to "Rang for $seconds seconds"
        }
        "lock" -> {
            val dpm = ctx.getSystemService(DevicePolicyManager::class.java)
            if (dpm.isAdminActive(AdminReceiver.component(ctx))) {
                dpm.lockNow()
                true to "Screen locked"
            } else {
                false to "Lock is not turned on in the NexGuard app on this phone"
            }
        }
        "locate" -> {
            val location = Recorder.currentLocation(ctx, precise = true)
            if (location != null) {
                Recorder.save(ctx, location)
                true to "Fresh location found (±${location.accuracy.roundToInt()} m)"
            } else {
                false to "Could not get a location (GPS off or no signal)"
            }
        }
        "message" -> {
            val message = text(command, "message") ?: return false to "Empty message"
            Notifications.ownerMessage(ctx, message, text(command, "contactPhone"))
            true to "Message shown"
        }
        else -> false to "This app version does not know \"${command.type}\""
    }
}
