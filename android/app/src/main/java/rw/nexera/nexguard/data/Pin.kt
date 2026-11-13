package rw.nexera.nexguard.data

import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/** The owner's PIN, needed to stop protection. Only a slow salted hash is saved. */
object Pin {
    const val MIN_LENGTH = 4
    const val MAX_LENGTH = 8
    const val MAX_TRIES = 5
    const val LOCK_MS = 5 * 60_000L
    private const val ITERATIONS = 60_000

    fun isValid(pin: String) = pin.length in MIN_LENGTH..MAX_LENGTH && pin.all { it.isDigit() }

    fun newSalt(): String = ByteArray(16).also { SecureRandom().nextBytes(it) }.let { Base64.encodeToString(it, Base64.NO_WRAP) }

    suspend fun hash(pin: String, salt: String): String = withContext(Dispatchers.Default) {
        val spec = PBEKeySpec(pin.toCharArray(), Base64.decode(salt, Base64.NO_WRAP), ITERATIONS, 256)
        val bytes = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
        spec.clearPassword()
        Base64.encodeToString(bytes, Base64.NO_WRAP)
    }

    fun same(a: String, b: String) = MessageDigest.isEqual(a.toByteArray(), b.toByteArray())
}

sealed interface PinCheck {
    data object Ok : PinCheck
    data object NotSet : PinCheck
    /** [triesLeft] is 0 when this wrong try locked the PIN (the owner gets an alert). */
    data class Wrong(val triesLeft: Int) : PinCheck
    data class Locked(val untilMs: Long) : PinCheck
}
