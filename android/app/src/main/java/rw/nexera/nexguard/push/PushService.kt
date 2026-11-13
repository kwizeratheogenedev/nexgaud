package rw.nexera.nexguard.push

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import rw.nexera.nexguard.data.Prefs
import rw.nexera.nexguard.tracking.SyncWorker

/**
 * A push only says "you have commands"; the phone then asks the API for them.
 * Nothing sensitive travels through Firebase.
 */
class PushService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        SyncWorker.enqueue(applicationContext)
    }

    override fun onNewToken(token: String) {
        val ctx = applicationContext
        CoroutineScope(Dispatchers.IO).launch {
            Prefs(ctx).setPushToken(token)
            SyncWorker.enqueue(ctx) // the heartbeat sends the new token to the API
        }
    }
}
