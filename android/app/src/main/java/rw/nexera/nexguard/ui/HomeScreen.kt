package rw.nexera.nexguard.ui

import android.text.format.DateUtils
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import rw.nexera.nexguard.R
import rw.nexera.nexguard.data.AppState
import rw.nexera.nexguard.data.LocalDb
import rw.nexera.nexguard.data.Prefs
import rw.nexera.nexguard.tracking.Events
import rw.nexera.nexguard.tracking.Notifications
import rw.nexera.nexguard.tracking.Recorder
import rw.nexera.nexguard.tracking.SyncWorker
import rw.nexera.nexguard.tracking.TrackingService
import rw.nexera.nexguard.tracking.WatchdogWorker
import rw.nexera.nexguard.util.DeviceInfo

private enum class Dialog { None, PinToStop, ConfirmStop, PinToChange, NewPin, SetFirstPin }

@Composable
fun HomeScreen(state: AppState) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val prefs = remember { Prefs(ctx) }
    val waiting by remember { LocalDb.get(ctx).points().countFlow() }.collectAsStateWithLifecycle(initialValue = 0)

    var tick by remember { mutableIntStateOf(0) }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { tick++ }
    val permissions = remember(tick) { DeviceInfo.permissions(ctx) }
    var dialog by remember { mutableStateOf(Dialog.None) }
    var sending by remember { mutableStateOf(false) }
    var stopping by remember { mutableStateOf(false) }

    val warnings = buildList {
        if (permissions.location != "always") add(stringResource(R.string.home_warn_location))
        if (permissions.batteryOptimized) add(stringResource(R.string.home_warn_battery))
        if (!permissions.notifications) add(stringResource(R.string.home_warn_notifications))
        if (!state.pinSet) add(stringResource(R.string.home_warn_pin))
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
                    stringResource(if (state.lostMode) R.string.home_lost_title else R.string.home_protected_title),
                    style = MaterialTheme.typography.titleLarge,
                )
                Text(stringResource(if (state.lostMode) R.string.home_lost_body else R.string.home_protected_body))
            }
        }

        Text(stringResource(R.string.home_account, state.phone ?: "—"))
        Text(stringResource(R.string.home_this_phone, state.deviceName ?: DeviceInfo.defaultName))
        Text(
            stringResource(
                R.string.home_last_upload,
                if (state.lastUploadAt > 0) {
                    DateUtils.getRelativeTimeSpanString(state.lastUploadAt).toString()
                } else {
                    stringResource(R.string.home_not_yet)
                },
            ),
        )
        Text(stringResource(R.string.home_waiting, waiting))

        if (warnings.isNotEmpty()) {
            Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer)) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    warnings.forEach { Text("• $it") }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (!state.pinSet) Button(onClick = { dialog = Dialog.SetFirstPin }) { Text(stringResource(R.string.pin_set_title)) }
                        Button(onClick = { scope.launch { prefs.setSetupDone(false) } }) { Text(stringResource(R.string.home_fix_setup)) }
                    }
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
        ) { Text(stringResource(if (sending) R.string.home_finding else R.string.home_send_now)) }

        if (state.pinSet) {
            TextButton(onClick = { dialog = Dialog.PinToChange }) { Text(stringResource(R.string.home_change_pin)) }
        }
        TextButton(
            onClick = { dialog = if (state.pinSet) Dialog.PinToStop else Dialog.ConfirmStop },
            enabled = !stopping,
        ) { Text(stringResource(R.string.home_stop)) }
    }

    when (dialog) {
        Dialog.None -> Unit
        Dialog.PinToStop -> CheckPinDialog(
            title = stringResource(R.string.home_stop_pin_title),
            onOk = { dialog = Dialog.ConfirmStop },
            onDismiss = { dialog = Dialog.None },
        )
        Dialog.PinToChange -> CheckPinDialog(
            title = stringResource(R.string.home_change_pin),
            onOk = { dialog = Dialog.NewPin },
            onDismiss = { dialog = Dialog.None },
        )
        Dialog.NewPin, Dialog.SetFirstPin -> SetPinDialog(onDone = { dialog = Dialog.None }, onDismiss = { dialog = Dialog.None })
        Dialog.ConfirmStop -> AlertDialog(
            onDismissRequest = { dialog = Dialog.None },
            title = { Text(stringResource(R.string.home_stop_title)) },
            text = { Text(stringResource(R.string.home_stop_body)) },
            confirmButton = {
                TextButton(onClick = {
                    dialog = Dialog.None
                    scope.launch {
                        stopping = true
                        // Tell the owner first, while the device token still exists.
                        Events.sendNow(ctx, Events.PROTECTION_OFF)
                        TrackingService.stop(ctx)
                        WatchdogWorker.cancel(ctx)
                        Notifications.cancelLost(ctx)
                        LocalDb.get(ctx).points().clear()
                        prefs.clearPairing()
                        stopping = false
                    }
                }) { Text(stringResource(R.string.home_stop_confirm)) }
            },
            dismissButton = { TextButton(onClick = { dialog = Dialog.None }) { Text(stringResource(R.string.cancel)) } },
        )
    }
}
