package rw.nexera.nexguard

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import rw.nexera.nexguard.data.AppState
import rw.nexera.nexguard.data.Prefs

/**
 * The screen a finder sees: the owner's message and a button to call them.
 * It can show over the lock screen, and it offers nothing else: no settings, no way to stop protection.
 */
class LostActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
        }
        enableEdgeToEdge()
        val prefs = Prefs(this)
        setContent {
            MaterialTheme {
                val state by prefs.state.collectAsStateWithLifecycle<AppState?>(initialValue = null)
                val s = state ?: return@MaterialTheme
                if (!s.lostMode) {
                    finish()
                    return@MaterialTheme
                }
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.errorContainer) {
                    LostContent(s.lostMessage, s.lostContact, onCall = { phone ->
                        startActivity(Intent(Intent.ACTION_DIAL, Uri.fromParts("tel", phone, null)))
                    })
                }
            }
        }
    }
}

@androidx.compose.runtime.Composable
fun LostContent(message: String?, contact: String?, onCall: (String) -> Unit) {
    Column(
        Modifier.fillMaxSize().systemBarsPadding().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(stringResource(R.string.lost_title), style = MaterialTheme.typography.headlineMedium, textAlign = TextAlign.Center)
        Text(
            message?.takeIf { it.isNotBlank() } ?: stringResource(R.string.lost_default_message),
            style = MaterialTheme.typography.titleLarge,
            textAlign = TextAlign.Center,
        )
        if (!contact.isNullOrBlank()) {
            Button(onClick = { onCall(contact) }, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.lost_call_number, contact))
            }
        }
        Text(stringResource(R.string.lost_finder_note), style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center)
    }
}
