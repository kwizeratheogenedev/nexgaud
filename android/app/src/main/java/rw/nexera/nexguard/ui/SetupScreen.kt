package rw.nexera.nexguard.ui

import android.Manifest
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import kotlinx.coroutines.launch
import rw.nexera.nexguard.R
import rw.nexera.nexguard.commands.AdminReceiver
import rw.nexera.nexguard.data.AppState
import rw.nexera.nexguard.data.Prefs
import rw.nexera.nexguard.tracking.SyncWorker
import rw.nexera.nexguard.tracking.TrackingService
import rw.nexera.nexguard.tracking.WatchdogWorker
import rw.nexera.nexguard.util.DeviceInfo

private fun openAppSettings(ctx: Context) {
    ctx.startActivity(
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", ctx.packageName, null))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    )
}

@Composable
private fun Step(
    number: Int,
    title: String,
    body: String,
    done: Boolean,
    optional: Boolean = false,
    action: String? = null,
    onAction: () -> Unit = {},
    extra: (@Composable () -> Unit)? = null,
) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(if (done) "✓" else "$number", style = MaterialTheme.typography.titleMedium)
                Text(
                    if (optional) stringResource(R.string.setup_optional, title) else title,
                    style = MaterialTheme.typography.titleMedium,
                )
            }
            Text(body, style = MaterialTheme.typography.bodyMedium)
            extra?.invoke()
            if (!done && action != null) {
                Button(onClick = onAction) { Text(action) }
            }
        }
    }
}

/**
 * Guided setup. Each step explains why before Android's own prompt appears
 * (Google Play requires this "prominent disclosure" for background location).
 */
@Composable
fun SetupScreen(state: AppState) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()

    // Re-check every step whenever the user comes back from a system screen.
    var tick by remember { mutableIntStateOf(0) }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { tick++ }
    var choosingPin by remember { mutableStateOf(false) }

    val needsNotificationPermission = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
    val notificationsOk = remember(tick) { DeviceInfo.notificationsEnabled(ctx) }
    val locationOk = remember(tick) { DeviceInfo.hasPreciseLocation(ctx) }
    val anyLocation = remember(tick) { DeviceInfo.hasForegroundLocation(ctx) }
    val backgroundOk = remember(tick) { DeviceInfo.hasBackgroundLocation(ctx) }
    val batteryOk = remember(tick) { DeviceInfo.ignoringBatteryOptimizations(ctx) }
    val lockOk = remember(tick) { DeviceInfo.lockEnabled(ctx) }

    val notificationLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        if (!it) openAppSettings(ctx)
        tick++
    }
    val locationLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        if (result.values.none { it }) openAppSettings(ctx)
        tick++
    }
    val backgroundLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        if (!it) openAppSettings(ctx)
        tick++
    }
    val adminLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { tick++ }
    val adminExplanation = stringResource(R.string.admin_add_explanation)

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(stringResource(R.string.setup_title), style = MaterialTheme.typography.headlineSmall)
        Text(stringResource(R.string.setup_intro))

        var n = 1
        if (needsNotificationPermission) {
            Step(
                number = n++,
                title = stringResource(R.string.setup_notifications),
                body = stringResource(R.string.setup_notifications_body),
                done = notificationsOk,
                action = stringResource(R.string.setup_notifications_action),
                onAction = { notificationLauncher.launch(Manifest.permission.POST_NOTIFICATIONS) },
            )
        }
        Step(
            number = n++,
            title = stringResource(R.string.setup_location),
            body = stringResource(R.string.setup_location_body),
            done = locationOk,
            action = stringResource(R.string.setup_location_action),
            onAction = {
                locationLauncher.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
            },
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            Step(
                number = n++,
                title = stringResource(R.string.setup_background),
                body = stringResource(R.string.setup_background_body),
                done = backgroundOk,
                action = if (anyLocation) stringResource(R.string.setup_background_action) else null,
                onAction = { backgroundLauncher.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION) },
            )
        }
        Step(
            number = n++,
            title = stringResource(R.string.setup_battery),
            body = stringResource(R.string.setup_battery_body, DeviceInfo.batteryTip(ctx)),
            done = batteryOk,
            action = stringResource(R.string.setup_battery_action),
            onAction = {
                runCatching {
                    ctx.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                }.onFailure { openAppSettings(ctx) }
            },
            extra = {
                if (!batteryOk) TextButton(onClick = { openAppSettings(ctx) }) { Text(stringResource(R.string.setup_app_settings)) }
            },
        )
        Step(
            number = n++,
            title = stringResource(R.string.setup_pin),
            body = stringResource(R.string.setup_pin_body),
            done = state.pinSet,
            action = stringResource(R.string.pin_set_title),
            onAction = { choosingPin = true },
        )
        Step(
            number = n,
            title = stringResource(R.string.setup_lock),
            body = stringResource(R.string.setup_lock_body),
            done = lockOk,
            optional = true,
            action = stringResource(R.string.setup_lock_action),
            onAction = {
                adminLauncher.launch(
                    Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN)
                        .putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, AdminReceiver.component(ctx))
                        .putExtra(DevicePolicyManager.EXTRA_ADD_EXPLANATION, adminExplanation),
                )
            },
        )

        if (anyLocation && !backgroundOk) {
            Text(
                stringResource(R.string.setup_background_warning),
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall,
            )
        }

        Button(
            onClick = {
                scope.launch {
                    Prefs(ctx).setSetupDone(true)
                    TrackingService.start(ctx, lostMode = false)
                    WatchdogWorker.schedule(ctx)
                    SyncWorker.enqueue(ctx)
                }
            },
            enabled = anyLocation && state.pinSet,
            modifier = Modifier.fillMaxWidth(),
        ) { Text(stringResource(R.string.setup_start)) }
    }

    if (choosingPin) SetPinDialog(onDone = { choosingPin = false }, onDismiss = { choosingPin = false })
}
