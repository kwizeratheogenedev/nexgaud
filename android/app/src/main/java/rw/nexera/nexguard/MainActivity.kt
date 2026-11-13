package rw.nexera.nexguard

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import rw.nexera.nexguard.data.AppState
import rw.nexera.nexguard.data.Prefs
import rw.nexera.nexguard.tracking.SyncWorker
import rw.nexera.nexguard.tracking.TrackingService
import rw.nexera.nexguard.tracking.WatchdogWorker
import rw.nexera.nexguard.ui.HomeScreen
import rw.nexera.nexguard.ui.SetupScreen
import rw.nexera.nexguard.ui.SignInScreen

class MainActivity : ComponentActivity() {
    private val prefs by lazy { Prefs(this) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            MaterialTheme {
                val state by prefs.state.collectAsStateWithLifecycle<AppState?>(initialValue = null)
                Scaffold(modifier = Modifier.fillMaxSize()) { inner ->
                    Box(Modifier.padding(inner)) {
                        val s = state
                        when {
                            s == null -> Unit
                            !s.paired -> SignInScreen()
                            !s.setupDone -> SetupScreen()
                            else -> HomeScreen(s)
                        }
                    }
                }
            }
        }
    }

    // Opening the app is a moment Android allows starting the foreground service,
    // so this restarts protection if the phone's maker killed it.
    override fun onResume() {
        super.onResume()
        lifecycleScope.launch {
            val s = prefs.snapshot()
            if (s.paired && s.setupDone) {
                TrackingService.start(this@MainActivity, s.lostMode)
                WatchdogWorker.schedule(this@MainActivity)
                SyncWorker.enqueue(this@MainActivity)
            }
        }
    }
}
