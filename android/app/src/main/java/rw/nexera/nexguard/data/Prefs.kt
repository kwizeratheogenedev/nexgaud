package rw.nexera.nexguard.data

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
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
    val lostMessage: String? = null,
    val lostContact: String? = null,
    val pinSet: Boolean = false,
) {
    val paired get() = deviceToken != null
}

/** Small settings saved on the phone. The device token is encrypted with the Android Keystore. */
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
        val lostMessage = stringPreferencesKey("lost_message")
        val lostContact = stringPreferencesKey("lost_contact")
        val pinHash = stringPreferencesKey("pin_hash")
        val pinSalt = stringPreferencesKey("pin_salt")
        val pinFails = intPreferencesKey("pin_fails")
        val pinLockedUntil = longPreferencesKey("pin_locked_until")
    }

    val state: Flow<AppState> = store.data.map { p ->
        AppState(
            phone = p[K.phone],
            deviceId = p[K.deviceId],
            deviceName = p[K.deviceName],
            deviceToken = p[K.deviceToken]?.let(SecureStore::decrypt),
            setupDone = p[K.setupDone] ?: false,
            pushToken = p[K.pushToken],
            lastUploadAt = p[K.lastUploadAt] ?: 0,
            lostMode = p[K.lostMode] ?: false,
            lostMessage = p[K.lostMessage],
            lostContact = p[K.lostContact],
            pinSet = p[K.pinHash] != null,
        )
    }

    suspend fun snapshot(): AppState = state.first()

    /** Encrypts a token saved in plain text by version 0.2. */
    suspend fun encryptLegacyToken() = store.edit {
        val raw = it[K.deviceToken] ?: return@edit
        if (!SecureStore.isEncrypted(raw)) it[K.deviceToken] = SecureStore.encrypt(raw)
    }

    suspend fun savePairing(phone: String, deviceId: String, deviceName: String, deviceToken: String) {
        val encrypted = SecureStore.encrypt(deviceToken)
        store.edit {
            it[K.phone] = phone
            it[K.deviceId] = deviceId
            it[K.deviceName] = deviceName
            it[K.deviceToken] = encrypted
        }
    }

    suspend fun setSetupDone(done: Boolean) = store.edit { it[K.setupDone] = done }
    suspend fun setPushToken(token: String) = store.edit { it[K.pushToken] = token }
    suspend fun setLastUploadAt(time: Long) = store.edit { it[K.lastUploadAt] = time }

    suspend fun setLostMode(lost: Boolean, message: String? = null, contact: String? = null) = store.edit {
        it[K.lostMode] = lost
        if (lost && message != null) it[K.lostMessage] = message else it.remove(K.lostMessage)
        if (lost && contact != null) it[K.lostContact] = contact else it.remove(K.lostContact)
    }

    suspend fun setPin(pin: String) {
        val salt = Pin.newSalt()
        val hash = Pin.hash(pin, salt)
        store.edit {
            it[K.pinSalt] = salt
            it[K.pinHash] = hash
            it.remove(K.pinFails)
            it.remove(K.pinLockedUntil)
        }
    }

    /** Checks the PIN, counting wrong tries; 5 wrong tries lock it for 5 minutes. */
    suspend fun checkPin(pin: String, now: Long = System.currentTimeMillis()): PinCheck {
        val p = store.data.first()
        val hash = p[K.pinHash] ?: return PinCheck.NotSet
        val salt = p[K.pinSalt] ?: return PinCheck.NotSet
        val lockedUntil = p[K.pinLockedUntil] ?: 0
        if (lockedUntil > now) return PinCheck.Locked(lockedUntil)

        if (Pin.same(Pin.hash(pin, salt), hash)) {
            store.edit {
                it.remove(K.pinFails)
                it.remove(K.pinLockedUntil)
            }
            return PinCheck.Ok
        }
        val fails = (p[K.pinFails] ?: 0) + 1
        return if (fails >= Pin.MAX_TRIES) {
            store.edit {
                it.remove(K.pinFails)
                it[K.pinLockedUntil] = now + Pin.LOCK_MS
            }
            PinCheck.Wrong(0)
        } else {
            store.edit { it[K.pinFails] = fails }
            PinCheck.Wrong(Pin.MAX_TRIES - fails)
        }
    }

    /** Forgets the pairing and the PIN (keeps the push token, which belongs to the app install). */
    suspend fun clearPairing() = store.edit {
        listOf(
            K.phone, K.deviceId, K.deviceName, K.deviceToken, K.setupDone, K.lastUploadAt,
            K.lostMode, K.lostMessage, K.lostContact, K.pinHash, K.pinSalt, K.pinFails, K.pinLockedUntil,
        ).forEach { key -> it.remove(key) }
    }
}
