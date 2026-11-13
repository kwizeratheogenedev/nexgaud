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
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import kotlinx.coroutines.launch
import rw.nexera.nexguard.commands.AdminReceiver
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
                Text(title + if (optional) " (optional)" else "", style = MaterialTheme.typography.titleMedium)
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
fun SetupScreen() {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()

    // Re-check every step whenever the user comes back from a system screen.
    var tick by remember { mutableIntStateOf(0) }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { tick++ }

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

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Set up protection", style = MaterialTheme.typography.headlineSmall)
        Text("A few permissions let NexGuard keep working when the app is closed or the screen is locked.")

        var n = 1
        if (needsNotificationPermission) {
            Step(
                number = n++,
                title = "Notifications",
                body = "NexGuard shows a notification while it protects this phone, and shows alarms and messages from you.",
                done = notificationsOk,
                action = "Allow notifications",
                onAction = { notificationLauncher.launch(Manifest.permission.POST_NOTIFICATIONS) },
            )
        }
        Step(
            number = n++,
            title = "Location",
            body = "NexGuard collects this phone's location and sends it to your NexGuard account, so you can find the phone if it is lost. Choose \"Precise\".",
            done = locationOk,
            action = "Allow location",
            onAction = {
                locationLauncher.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
            },
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            Step(
                number = n++,
                title = "Location all the time",
                body = "To keep finding the phone when NexGuard is closed or the screen is locked, choose \"Allow all the time\" on the next screen. Your location is only shared with your own account.",
                done = backgroundOk,
                action = if (anyLocation) "Choose \"Allow all the time\"" else null,
                onAction = { backgroundLauncher.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION) },
            )
        }
        Step(
            number = n++,
            title = "Battery",
            body = "Many phones stop apps in the background to save battery. Let NexGuard run without restrictions. ${DeviceInfo.batteryTip()}",
            done = batteryOk,
            action = "Open battery settings",
            onAction = {
                runCatching {
                    ctx.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                }.onFailure { openAppSettings(ctx) }
            },
            extra = { if (!batteryOk) TextButton(onClick = { openAppSettings(ctx) }) { Text("Open NexGuard's app settings") } },
        )
        Step(
            number = n,
            title = "Remote lock",
            body = "Lets you lock this phone's screen from the dashboard. NexGuard can only lock the screen; it cannot read or erase anything.",
            done = lockOk,
            optional = true,
            action = "Turn on remote lock",
            onAction = {
                adminLauncher.launch(
                    Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN)
                        .putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, AdminReceiver.component(ctx))
                        .putExtra(
                            DevicePolicyManager.EXTRA_ADD_EXPLANATION,
                            "Lets the owner lock this screen from the NexGuard dashboard if the phone is lost.",
                        ),
                )
            },
        )

        if (anyLocation && !backgroundOk) {
            Text(
                "Without \"Allow all the time\", NexGuard only works while the app is open or its notification is showing.",
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
            enabled = anyLocation,
            modifier = Modifier.fillMaxWidth(),
        ) { Text("Start protecting this phone") }
    }
}
