package rw.nexera.nexguard.util

import android.Manifest
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import android.telephony.SubscriptionManager
import android.telephony.TelephonyManager
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import rw.nexera.nexguard.BuildConfig
import rw.nexera.nexguard.R
import rw.nexera.nexguard.commands.AdminReceiver
import rw.nexera.nexguard.data.HeartbeatBody
import rw.nexera.nexguard.data.PermissionsDto
import java.security.MessageDigest

/** What the phone reports about itself, and which setup steps are done. */
object DeviceInfo {
    val defaultName: String
        get() = "${Build.MANUFACTURER.replaceFirstChar { it.uppercase() }} ${Build.MODEL}".trim()

    private fun granted(ctx: Context, permission: String) =
        ContextCompat.checkSelfPermission(ctx, permission) == PackageManager.PERMISSION_GRANTED

    fun hasForegroundLocation(ctx: Context) =
        granted(ctx, Manifest.permission.ACCESS_FINE_LOCATION) || granted(ctx, Manifest.permission.ACCESS_COARSE_LOCATION)

    fun hasPreciseLocation(ctx: Context) = granted(ctx, Manifest.permission.ACCESS_FINE_LOCATION)

    /** "Allow all the time". Before Android 10 there was no separate background permission. */
    fun hasBackgroundLocation(ctx: Context) =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            granted(ctx, Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        } else {
            hasForegroundLocation(ctx)
        }

    fun notificationsEnabled(ctx: Context) = NotificationManagerCompat.from(ctx).areNotificationsEnabled()

    fun ignoringBatteryOptimizations(ctx: Context): Boolean =
        ctx.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(ctx.packageName)

    fun lockEnabled(ctx: Context): Boolean =
        ctx.getSystemService(DevicePolicyManager::class.java).isAdminActive(AdminReceiver.component(ctx))

    fun permissions(ctx: Context) = PermissionsDto(
        location = when {
            hasBackgroundLocation(ctx) -> "always"
            hasForegroundLocation(ctx) -> "while_in_use"
            else -> "denied"
        },
        notifications = notificationsEnabled(ctx),
        batteryOptimized = !ignoringBatteryOptimizations(ctx),
        deviceAdmin = lockEnabled(ctx),
    )

    fun battery(ctx: Context): Int? =
        ctx.getSystemService(BatteryManager::class.java)
            .getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
            .takeIf { it in 0..100 }

    private fun charging(ctx: Context): Boolean = ctx.getSystemService(BatteryManager::class.java).isCharging

    private fun network(ctx: Context): String {
        val cm = ctx.getSystemService(ConnectivityManager::class.java)
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return "none"
        return when {
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
            else -> "other"
        }
    }

    /**
     * A one-way hash of the SIM's network, country and subscription ID, so the API can alert the owner
     * when a different SIM is inserted (even one from the same network). "no-sim" when none is in.
     * Needs no permission and never sends the phone number or the SIM's serial number.
     */
    private fun simFingerprint(ctx: Context): String? {
        val tm = ctx.getSystemService(TelephonyManager::class.java) ?: return null
        if (tm.simState == TelephonyManager.SIM_STATE_ABSENT) return "no-sim"
        if (tm.simState != TelephonyManager.SIM_STATE_READY) return null // locked or loading: report nothing yet
        // Android gives each SIM card a new subscription ID the first time it sees it.
        val subscription = SubscriptionManager.getDefaultSubscriptionId()
        val raw = "${tm.simOperator}|${tm.simCountryIso}|$subscription"
        return MessageDigest.getInstance("SHA-256").digest(raw.toByteArray()).joinToString("") { "%02x".format(it) }.take(32)
    }

    fun heartbeat(ctx: Context, pushToken: String?) = HeartbeatBody(
        battery = battery(ctx),
        charging = charging(ctx),
        network = network(ctx),
        simFingerprint = simFingerprint(ctx),
        pushToken = pushToken,
        appVersion = BuildConfig.VERSION_NAME,
        osVersion = Build.VERSION.RELEASE,
        permissions = permissions(ctx),
    )

    /**
     * Where to switch off battery killers on common brands. Menu names vary by model and
     * software version, so these are starting points ("usually"), shown with a button that
     * opens the system battery settings.
     */
    fun batteryTip(ctx: Context): String = ctx.getString(
        when (Build.MANUFACTURER.lowercase()) {
            "tecno", "infinix", "itel" -> R.string.battery_tip_transsion
            "samsung" -> R.string.battery_tip_samsung
            "xiaomi", "redmi", "poco" -> R.string.battery_tip_xiaomi
            "huawei", "honor" -> R.string.battery_tip_huawei
            "oppo", "realme", "oneplus", "vivo" -> R.string.battery_tip_oppo
            else -> R.string.battery_tip_other
        },
    )
}
