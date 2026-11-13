package rw.nexera.nexguard

import android.app.Application
import android.util.Log
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import rw.nexera.nexguard.data.Prefs
import rw.nexera.nexguard.tracking.Notifications

class NexGuardApp : Application() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onCreate() {
        super.onCreate()
        Notifications.createChannels(this)
        scope.launch { Prefs(this@NexGuardApp).encryptLegacyToken() }
        initPush()
    }

    /** Firebase is configured from build settings (see app/build.gradle.kts), so no google-services.json. */
    private fun initPush() {
        if (BuildConfig.FCM_APP_ID.isBlank()) {
            Log.i(TAG, "Push not configured; commands arrive with each location upload")
            return
        }
        try {
            if (FirebaseApp.getApps(this).isEmpty()) {
                FirebaseApp.initializeApp(
                    this,
                    FirebaseOptions.Builder()
                        .setApplicationId(BuildConfig.FCM_APP_ID)
                        .setApiKey(BuildConfig.FCM_API_KEY)
                        .setProjectId(BuildConfig.FCM_PROJECT_ID)
                        .setGcmSenderId(BuildConfig.FCM_SENDER_ID)
                        .build(),
                )
            }
            FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
                scope.launch { Prefs(this@NexGuardApp).setPushToken(token) }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Push could not start", e)
        }
    }

    companion object {
        private const val TAG = "NexGuardApp"
    }
}
