package rw.nexera.nexguard.data

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.store by preferencesDataStore(name = "nexguard")

data class AppState(
    val phone: String? = null,
    val deviceId: String? = null,
    val deviceName: String? = null,
    val deviceToken: String? = null,
    val setupDone: Boolean = false,
    val pushToken: String? = null,
    val lastUploadAt: Long = 0,
    val lostMode: Boolean = false,
) {
    val paired get() = deviceToken != null
}

/**
 * Small settings saved on the phone.
 * TODO(Phase 2): encrypt the device token with the Android Keystore.
 */
class Prefs(context: Context) {
    private val store = context.applicationContext.store

    private object K {
        val phone = stringPreferencesKey("phone")
        val deviceId = stringPreferencesKey("device_id")
        val deviceName = stringPreferencesKey("device_name")
        val deviceToken = stringPreferencesKey("device_token")
        val setupDone = booleanPreferencesKey("setup_done")
        val pushToken = stringPreferencesKey("push_token")
        val lastUploadAt = longPreferencesKey("last_upload_at")
        val lostMode = booleanPreferencesKey("lost_mode")
    }

    val state: Flow<AppState> = store.data.map { p ->
        AppState(
            phone = p[K.phone],
            deviceId = p[K.deviceId],
            deviceName = p[K.deviceName],
            deviceToken = p[K.deviceToken],
            setupDone = p[K.setupDone] ?: false,
            pushToken = p[K.pushToken],
            lastUploadAt = p[K.lastUploadAt] ?: 0,
            lostMode = p[K.lostMode] ?: false,
        )
    }

    suspend fun snapshot(): AppState = state.first()

    suspend fun savePairing(phone: String, deviceId: String, deviceName: String, deviceToken: String) {
        store.edit {
            it[K.phone] = phone
            it[K.deviceId] = deviceId
            it[K.deviceName] = deviceName
            it[K.deviceToken] = deviceToken
        }
    }

    suspend fun setSetupDone(done: Boolean) = store.edit { it[K.setupDone] = done }
    suspend fun setPushToken(token: String) = store.edit { it[K.pushToken] = token }
    suspend fun setLastUploadAt(time: Long) = store.edit { it[K.lastUploadAt] = time }
    suspend fun setLostMode(lost: Boolean) = store.edit { it[K.lostMode] = lost }

    /** Forgets the pairing (keeps the push token, which belongs to the app install). */
    suspend fun clearPairing() = store.edit {
        it.remove(K.phone)
        it.remove(K.deviceId)
        it.remove(K.deviceName)
        it.remove(K.deviceToken)
        it.remove(K.setupDone)
        it.remove(K.lastUploadAt)
        it.remove(K.lostMode)
    }
}
