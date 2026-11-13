package rw.nexera.nexguard.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import rw.nexera.nexguard.R
import rw.nexera.nexguard.data.Pin
import rw.nexera.nexguard.data.PinCheck
import rw.nexera.nexguard.data.Prefs
import rw.nexera.nexguard.tracking.EventWorker
import rw.nexera.nexguard.tracking.Events
import kotlin.math.ceil

@Composable
private fun PinField(value: String, onChange: (String) -> Unit, label: String) {
    OutlinedTextField(
        value = value,
        onValueChange = { v -> onChange(v.filter { it.isDigit() }.take(Pin.MAX_LENGTH)) },
        label = { Text(label) },
        singleLine = true,
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Choose a new PIN (typed twice). */
@Composable
fun SetPinDialog(onDone: () -> Unit, onDismiss: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var pin by remember { mutableStateOf("") }
    var again by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val tooShort = stringResource(R.string.pin_too_short)
    val mismatch = stringResource(R.string.pin_mismatch)

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.pin_set_title)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(stringResource(R.string.pin_set_body))
                PinField(pin, { pin = it; error = null }, stringResource(R.string.pin_new))
                PinField(again, { again = it; error = null }, stringResource(R.string.pin_again))
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            TextButton(
                enabled = !busy,
                onClick = {
                    when {
                        !Pin.isValid(pin) -> error = tooShort
                        pin != again -> error = mismatch
                        else -> scope.launch {
                            busy = true
                            Prefs(ctx).setPin(pin)
                            busy = false
                            onDone()
                        }
                    }
                },
            ) { Text(stringResource(R.string.save)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
}

/**
 * Asks for the PIN before something only the owner may do. After 5 wrong tries the PIN
 * locks for 5 minutes and the owner gets an alert with this phone's location.
 */
@Composable
fun CheckPinDialog(title: String, onOk: () -> Unit, onDismiss: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var pin by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val res = ctx.resources

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                PinField(pin, { pin = it; error = null }, stringResource(R.string.pin_enter))
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            TextButton(
                enabled = !busy && pin.length >= Pin.MIN_LENGTH,
                onClick = {
                    scope.launch {
                        busy = true
                        when (val result = Prefs(ctx).checkPin(pin)) {
                            PinCheck.Ok, PinCheck.NotSet -> onOk()
                            is PinCheck.Wrong -> {
                                pin = ""
                                error = if (result.triesLeft > 0) {
                                    res.getQuantityString(R.plurals.pin_wrong, result.triesLeft, result.triesLeft)
                                } else {
                                    EventWorker.report(ctx, Events.PIN_FAILED)
                                    (Pin.LOCK_MS / 60_000).toInt().let { res.getQuantityString(R.plurals.pin_locked, it, it) }
                                }
                            }
                            is PinCheck.Locked -> {
                                val minutes = ceil((result.untilMs - System.currentTimeMillis()) / 60_000.0).toInt().coerceAtLeast(1)
                                error = res.getQuantityString(R.plurals.pin_locked, minutes, minutes)
                            }
                        }
                        busy = false
                    }
                },
            ) { Text(stringResource(R.string.ok)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
}
