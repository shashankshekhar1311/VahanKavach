package com.vahankavach.app.ui.garage

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.vahankavach.app.BuildConfig
import com.vahankavach.app.data.AuthRepository
import com.vahankavach.app.data.GarageRepository
import com.vahankavach.app.data.NotificationChannel
import com.vahankavach.app.data.Profile
import com.vahankavach.app.data.VehicleWithChallans
import com.vahankavach.app.util.sanitizeRegInput
import com.vahankavach.app.util.toStoredRegNumber
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.net.URLEncoder

data class GarageUiState(
    val loading: Boolean = true,
    val protecting: Boolean = false,
    val refreshingReg: String? = null,
    val profile: Profile? = null,
    val vehicles: List<VehicleWithChallans> = emptyList(),
    val regInput: String = "",
    val chassisInput: String = "",
    val banner: String? = null,
    val error: String? = null,
    val channelBusy: Boolean = false,
)

class GarageViewModel(
    private val auth: AuthRepository,
    private val garage: GarageRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(GarageUiState())
    val state: StateFlow<GarageUiState> = _state.asStateFlow()

    init {
        refresh()
    }

    fun onRegInputChange(raw: String) {
        _state.update { it.copy(regInput = sanitizeRegInput(raw).take(11), error = null) }
    }

    fun onChassisInputChange(raw: String) {
        val cleaned = raw.uppercase().replace(Regex("[^A-Z0-9]"), "").take(5)
        _state.update { it.copy(chassisInput = cleaned, error = null) }
    }

    fun refresh() {
        viewModelScope.launch {
            _state.update { it.copy(loading = true, error = null) }
            try {
                var profile = garage.fetchProfile()
                if (
                    profile?.channel() == NotificationChannel.SIGNAL ||
                    profile?.channel() == NotificationChannel.WHATSAPP
                ) {
                    garage.setPreferredChannel(NotificationChannel.TELEGRAM)
                    profile = garage.fetchProfile()
                }
                val vehicles = garage.fetchGarage()
                _state.update {
                    it.copy(loading = false, profile = profile, vehicles = vehicles)
                }
            } catch (e: Exception) {
                _state.update {
                    it.copy(loading = false, error = e.message ?: "Failed to load garage")
                }
            }
        }
    }

    fun protectVehicle() {
        val stored = toStoredRegNumber(_state.value.regInput)
        if (stored == null) {
            _state.update { it.copy(error = "Enter a valid Indian registration (e.g. KA01AB1234)") }
            return
        }
        val chassis = _state.value.chassisInput
        if (chassis.length != 5) {
            _state.update {
                it.copy(error = "Enter the last 5 characters of the chassis number from your RC")
            }
            return
        }
        viewModelScope.launch {
            _state.update { it.copy(protecting = true, error = null, banner = null) }
            try {
                val result = garage.syncVehicle(
                    stored,
                    forceRefresh = false,
                    mode = "claim",
                    chassisLast5 = chassis,
                )
                if (!result.success) {
                    throw IllegalStateException(result.error ?: "sync-vehicle failed")
                }
                val vehicles = garage.fetchGarage()
                _state.update {
                    it.copy(
                        protecting = false,
                        vehicles = vehicles,
                        regInput = "",
                        chassisInput = "",
                        banner = "Vehicle claimed and protected — compliance synced.",
                    )
                }
            } catch (e: Exception) {
                val msg = e.message ?: "Protect failed"
                _state.update {
                    it.copy(
                        protecting = false,
                        error = msg,
                        banner = if (msg.contains("Payment required", ignoreCase = true)) {
                            "Subscribe on the web garage (~₹1/day per vehicle), then claim again."
                        } else {
                            it.banner
                        },
                    )
                }
            }
        }
    }

    fun releaseVehicle(vehicleId: String, regNumber: String) {
        viewModelScope.launch {
            _state.update { it.copy(error = null, banner = null) }
            try {
                garage.releaseVehicle(vehicleId)
                val vehicles = garage.fetchGarage()
                _state.update {
                    it.copy(
                        vehicles = vehicles,
                        banner = "$regNumber released. A new owner can claim it with chassis proof.",
                    )
                }
            } catch (e: Exception) {
                _state.update { it.copy(error = e.message ?: "Release failed") }
            }
        }
    }

    fun refreshVehicle(regNumber: String) {
        viewModelScope.launch {
            _state.update { it.copy(refreshingReg = regNumber, error = null, banner = null) }
            try {
                val result = garage.syncVehicle(
                    regNumber,
                    forceRefresh = true,
                    mode = "refresh",
                )
                if (!result.success) {
                    throw IllegalStateException(result.error ?: "sync-vehicle failed")
                }
                val vehicles = garage.fetchGarage()
                _state.update {
                    it.copy(
                        refreshingReg = null,
                        vehicles = vehicles,
                        banner = "Compliance refreshed from upstream.",
                    )
                }
            } catch (e: Exception) {
                _state.update {
                    it.copy(refreshingReg = null, error = e.message ?: "Refresh failed")
                }
            }
        }
    }

    fun refreshAll() {
        viewModelScope.launch {
            _state.update { it.copy(loading = true, error = null, banner = null) }
            try {
                for (item in _state.value.vehicles) {
                    val result = garage.syncVehicle(
                        item.vehicle.regNumber,
                        forceRefresh = true,
                        mode = "refresh",
                    )
                    if (!result.success) {
                        throw IllegalStateException(result.error ?: "sync-vehicle failed")
                    }
                }
                val vehicles = garage.fetchGarage()
                _state.update {
                    it.copy(
                        loading = false,
                        vehicles = vehicles,
                        banner = if (vehicles.isEmpty()) {
                            "Garage is empty — add a registration."
                        } else {
                            "All vehicles force-synced."
                        },
                    )
                }
            } catch (e: Exception) {
                _state.update {
                    it.copy(loading = false, error = e.message ?: "Sync failed")
                }
            }
        }
    }

    fun setChannel(channel: NotificationChannel) {
        if (channel == NotificationChannel.WHATSAPP || channel == NotificationChannel.SIGNAL) {
            _state.update {
                it.copy(banner = "WhatsApp is paused for now. Use Telegram.")
            }
            return
        }
        viewModelScope.launch {
            _state.update { it.copy(channelBusy = true, error = null) }
            try {
                garage.setPreferredChannel(channel)
                val profile = garage.fetchProfile()
                _state.update {
                    it.copy(
                        channelBusy = false,
                        profile = profile,
                        banner = "Alerts will go to ${channel.name.lowercase().replaceFirstChar { c -> c.titlecase() }}.",
                    )
                }
            } catch (e: Exception) {
                _state.update {
                    it.copy(channelBusy = false, error = e.message ?: "Could not update channel")
                }
            }
        }
    }

    /** Returns deep link URL for Connect Telegram, or null if bot name missing. */
    suspend fun connectTelegramDeepLink(): String {
        val token = garage.ensureTelegramLinkToken()
        val bot = BuildConfig.TELEGRAM_BOT_NAME.removePrefix("@").trim()
        check(bot.isNotBlank()) { "Set TELEGRAM_BOT_NAME in local.properties" }
        val profile = garage.fetchProfile()
        _state.update { it.copy(profile = profile) }
        return "https://t.me/$bot?start=${URLEncoder.encode(token, Charsets.UTF_8.name())}"
    }

    fun unlinkTelegram() {
        viewModelScope.launch {
            _state.update { it.copy(channelBusy = true, error = null) }
            try {
                garage.unlinkTelegram()
                val profile = garage.fetchProfile()
                _state.update {
                    it.copy(channelBusy = false, profile = profile, banner = "Telegram unlinked.")
                }
            } catch (e: Exception) {
                _state.update {
                    it.copy(channelBusy = false, error = e.message ?: "Unlink failed")
                }
            }
        }
    }

    fun signOut() {
        viewModelScope.launch {
            try {
                auth.signOut()
            } catch (e: Exception) {
                _state.update { it.copy(error = e.message) }
            }
        }
    }

    companion object {
        fun factory(auth: AuthRepository, garage: GarageRepository): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    GarageViewModel(auth, garage) as T
            }
    }
}
