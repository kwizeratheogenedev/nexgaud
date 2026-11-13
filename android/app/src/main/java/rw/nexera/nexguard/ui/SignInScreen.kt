package rw.nexera.nexguard.ui

import android.content.Context
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import rw.nexera.nexguard.BuildConfig
import rw.nexera.nexguard.R
import rw.nexera.nexguard.data.Api
import rw.nexera.nexguard.data.ApiException
import rw.nexera.nexguard.data.Prefs
import rw.nexera.nexguard.util.DeviceInfo
import java.io.IOException

fun friendlyError(ctx: Context, e: Exception): String = when (e) {
    // The API's own messages are in English; the common ones are translated here.
    is ApiException -> when (e.code) {
        "code_invalid" -> ctx.getString(R.string.error_code_invalid)
        "code_expired" -> ctx.getString(R.string.error_code_expired)
        "too_many_requests" -> ctx.getString(R.string.error_too_many)
        "validation_failed" -> ctx.getString(R.string.error_phone_invalid)
        else -> e.message ?: ctx.getString(R.string.error_generic)
    }
    is IOException -> ctx.getString(R.string.error_offline)
    else -> ctx.getString(R.string.error_generic)
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
                error = friendlyError(ctx, e)
            } finally {
                busy = false
            }
        }
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(stringResource(R.string.app_name), style = MaterialTheme.typography.headlineLarge)
        Text(
            stringResource(R.string.signin_lead),
            style = MaterialTheme.typography.bodyLarge,
        )

        if (step == "phone") {
            OutlinedTextField(
                value = phone,
                onValueChange = { phone = it },
                label = { Text(stringResource(R.string.signin_phone)) },
                placeholder = { Text("0788 123 456") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                onClick = { submit { Api.requestCode(phone.trim()); step = "code" } },
                enabled = !busy && phone.isNotBlank(),
                modifier = Modifier.fillMaxWidth(),
            ) { Text(stringResource(if (busy) R.string.signin_sending else R.string.signin_send_code)) }
        } else {
            Text(stringResource(R.string.signin_code_sent, phone))
            OutlinedTextField(
                value = code,
                onValueChange = { v -> code = v.filter { it.isDigit() }.take(6) },
                label = { Text(stringResource(R.string.signin_code)) },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                label = { Text(stringResource(R.string.signin_name)) },
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
            ) { Text(stringResource(if (busy) R.string.signin_checking else R.string.signin_submit)) }
            TextButton(onClick = { step = "phone"; code = ""; error = null }) { Text(stringResource(R.string.signin_change_number)) }
        }

        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }

        Text(
            stringResource(R.string.signin_disclosure),
            style = MaterialTheme.typography.bodySmall,
        )
    }
}
