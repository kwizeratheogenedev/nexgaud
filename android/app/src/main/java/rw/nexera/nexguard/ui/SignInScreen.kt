package rw.nexera.nexguard.ui

import android.os.Build
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import rw.nexera.nexguard.BuildConfig
import rw.nexera.nexguard.data.Api
import rw.nexera.nexguard.data.ApiException
import rw.nexera.nexguard.data.Prefs
import rw.nexera.nexguard.util.DeviceInfo
import java.io.IOException

fun friendlyError(e: Exception): String = when (e) {
    is ApiException -> e.message ?: "Something went wrong"
    is IOException -> "No connection to NexGuard. Check your mobile data or Wi-Fi and try again."
    else -> "Something went wrong. Try again."
}

/** Sign in with an SMS code, then pair this phone with the account. */
@Composable
fun SignInScreen() {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val prefs = remember { Prefs(ctx) }

    var step by rememberSaveable { mutableStateOf("phone") }
    var phone by rememberSaveable { mutableStateOf("") }
    var code by rememberSaveable { mutableStateOf("") }
    var name by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    fun submit(block: suspend () -> Unit) {
        scope.launch {
            busy = true
            error = null
            try {
                block()
            } catch (e: Exception) {
                error = friendlyError(e)
            } finally {
                busy = false
            }
        }
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("NexGuard", style = MaterialTheme.typography.headlineLarge)
        Text(
            "Protect this phone. If it is lost, see where it is, ring it or lock it from any browser.",
            style = MaterialTheme.typography.bodyLarge,
        )

        if (step == "phone") {
            OutlinedTextField(
                value = phone,
                onValueChange = { phone = it },
                label = { Text("Your phone number") },
                placeholder = { Text("0788 123 456") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                onClick = { submit { Api.requestCode(phone.trim()); step = "code" } },
                enabled = !busy && phone.isNotBlank(),
                modifier = Modifier.fillMaxWidth(),
            ) { Text(if (busy) "Sending…" else "Send code") }
        } else {
            Text("We sent a 6-digit code by SMS to $phone.")
            OutlinedTextField(
                value = code,
                onValueChange = { v -> code = v.filter { it.isDigit() }.take(6) },
                label = { Text("Code") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                label = { Text("Your name (first time only)") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                onClick = {
                    submit {
                        val session = Api.verifyCode(phone.trim(), code, name)
                        val deviceName = DeviceInfo.defaultName
                        val paired = Api.registerDevice(
                            accessToken = session.accessToken,
                            name = deviceName,
                            brand = Build.MANUFACTURER,
                            model = Build.MODEL,
                            osVersion = Build.VERSION.RELEASE,
                            appVersion = BuildConfig.VERSION_NAME,
                            pushToken = prefs.snapshot().pushToken,
                        )
                        prefs.savePairing(session.user.phone, paired.device.id, paired.device.name, paired.deviceToken)
                    }
                },
                enabled = !busy && code.length == 6,
                modifier = Modifier.fillMaxWidth(),
            ) { Text(if (busy) "Checking…" else "Sign in and add this phone") }
            TextButton(onClick = { step = "phone"; code = ""; error = null }) { Text("Change number") }
        }

        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }

        Text(
            "After setup, this phone's location is shared with your NexGuard account. " +
                "A notification always shows while it is shared.",
            style = MaterialTheme.typography.bodySmall,
        )
    }
}
