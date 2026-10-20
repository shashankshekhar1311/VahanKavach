package com.vahankavach.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.lifecycle.viewmodel.compose.viewModel
import com.vahankavach.app.ui.auth.LoginScreen
import com.vahankavach.app.ui.auth.LoginViewModel
import com.vahankavach.app.ui.garage.GarageScreen
import com.vahankavach.app.ui.garage.GarageViewModel
import com.vahankavach.app.ui.theme.Safety
import com.vahankavach.app.ui.theme.VahanKavachTheme
import com.vahankavach.app.ui.theme.Zinc950
import io.github.jan.supabase.auth.status.SessionStatus

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val app = application as VahanKavachApp
        setContent {
            VahanKavachTheme {
                Surface(Modifier.fillMaxSize(), color = Zinc950) {
                    VahanKavachRoot(app)
                }
            }
        }
    }
}

@Composable
private fun VahanKavachRoot(app: VahanKavachApp) {
    val sessionStatus by app.authRepository.sessionStatus.collectAsState(
        initial = null as SessionStatus?,
    )

    when (val status = sessionStatus) {
        is SessionStatus.Authenticated -> {
            val garageVm: GarageViewModel = viewModel(
                factory = GarageViewModel.factory(app.authRepository, app.garageRepository),
            )
            GarageScreen(garageVm)
        }
        is SessionStatus.NotAuthenticated -> {
            val loginVm: LoginViewModel = viewModel(
                factory = LoginViewModel.factory(app.authRepository),
            )
            LoginScreen(loginVm)
        }
        null -> {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = Safety)
            }
        }
        else -> {
            // Initializing / refreshing session from storage
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = Safety)
            }
        }
    }
}
