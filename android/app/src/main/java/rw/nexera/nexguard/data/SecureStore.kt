package rw.nexera.nexguard.data

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Encrypts small secrets (the device token) with a key kept in the Android Keystore.
 * The key never leaves the phone's secure hardware, so a copy of the app's files is useless elsewhere.
 */
object SecureStore {
    private const val TAG = "SecureStore"
    private const val KEYSTORE = "AndroidKeyStore"
    private const val ALIAS = "nexguard_secrets_v1"
    private const val PREFIX = "v1:"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"

    private fun key(): SecretKey {
        val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    fun isEncrypted(stored: String) = stored.startsWith(PREFIX)

    fun encrypt(plain: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val body = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        return PREFIX + b64(cipher.iv) + ":" + b64(body)
    }

    /** Null if the value cannot be decrypted (for example after the Keystore was reset). */
    fun decrypt(stored: String): String? {
        if (!isEncrypted(stored)) return stored // saved by version 0.2, before encryption
        return try {
            val (iv, body) = stored.removePrefix(PREFIX).split(":", limit = 2)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, unb64(iv)))
            String(cipher.doFinal(unb64(body)), Charsets.UTF_8)
        } catch (e: Exception) {
            Log.w(TAG, "Could not decrypt a saved secret", e)
            null
        }
    }

    private fun b64(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.NO_WRAP)
    private fun unb64(text: String) = Base64.decode(text, Base64.NO_WRAP)
}
