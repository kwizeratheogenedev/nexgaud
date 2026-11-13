package rw.nexera.nexguard.ui

import android.text.format.DateUtils
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import rw.nexera.nexguard.data.AppState
import rw.nexera.nexguard.data.LocalDb
import rw.nexera.nexguard.data.Prefs
import rw.nexera.nexguard.tracking.Recorder
import rw.nexera.nexguard.tracking.SyncWorker
import rw.nexera.nexguard.tracking.TrackingService
import rw.nexera.nexguard.tracking.WatchdogWorker
import rw.nexera.nexguard.util.DeviceInfo

@Composable
fun HomeScreen(state: AppState) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val prefs = remember { Prefs(ctx) }
    val waiting by remember { LocalDb.get(ctx).points().countFlow() }.collectAsStateWithLifecycle(initialValue = 0)

    var tick by remember { mutableIntStateOf(0) }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { tick++ }
    val permissions = remember(tick) { DeviceInfo.permissions(ctx) }
    var confirmStop by remember { mutableStateOf(false) }
    var sending by remember { mutableStateOf(false) }

    val warnings = buildList {
        if (permissions.location != "always") add("Location is not set to \"Allow all the time\".")
        if (permissions.batteryOptimized) add("Battery optimisation may stop NexGuard in the background.")
        if (!permissions.notifications) add("Notifications are off, so alarms and messages cannot show.")
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Card(
            Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(
                containerColor = if (state.lostMode) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.primaryContainer,
            ),
        ) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    if (state.lostMode) "This phone is reported lost" else "This phone is protected",
                    style = MaterialTheme.typography.titleLarge,
                )
                Text(
                    if (state.lostMode) {
                        "Its location is sent every minute. If you found it, please contact the owner."
                    } else {
                        "Its location is shared with your NexGuard account about every 5 minutes."
                    },
                )
            }
        }

        Text("Account: ${state.phone ?: "—"}")
        Text("This phone: ${state.deviceName ?: DeviceInfo.defaultName}")
        Text(
            "Last upload: " + if (state.lastUploadAt > 0) {
                DateUtils.getRelativeTimeSpanString(state.lastUploadAt).toString()
            } else {
                "not yet"
            },
        )
        Text("Locations waiting to upload: $waiting")

        if (warnings.isNotEmpty()) {
            Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer)) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    warnings.forEach { Text("• $it") }
                    Button(onClick = { scope.launch { prefs.setSetupDone(false) } }) { Text("Fix setup") }
                }
            }
        }

        Button(
            onClick = {
                scope.launch {
                    sending = true
                    Recorder.currentLocation(ctx, precise = true)?.let { Recorder.save(ctx, it) }
                    SyncWorker.enqueue(ctx)
                    sending = false
                }
            },
            enabled = !sending,
            modifier = Modifier.fillMaxWidth(),
        ) { Text(if (sending) "Finding location…" else "Send my location now") }

        // TODO(Phase 2): require the owner's PIN or fingerprint to stop protection.
        TextButton(onClick = { confirmStop = true }) { Text("Stop protecting this phone") }
    }

    if (confirmStop) {
        AlertDialog(
            onDismissRequest = { confirmStop = false },
            title = { Text("Stop protection?") },
            text = {
                Text(
                    "This phone stops sharing its location. To remove it from your account, " +
                        "also delete it in the NexGuard dashboard.",
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    confirmStop = false
                    scope.launch {
                        TrackingService.stop(ctx)
                        WatchdogWorker.cancel(ctx)
                        LocalDb.get(ctx).points().clear()
                        prefs.clearPairing()
                    }
                }) { Text("Stop") }
            },
            dismissButton = { TextButton(onClick = { confirmStop = false }) { Text("Cancel") } },
        )
    }
}
