package com.vahankavach.app.ui.auth

import android.util.Patterns
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.vahankavach.app.data.AuthRepository
import com.vahankavach.app.util.formatMobileInput
import com.vahankavach.app.util.isValidIndianMobile
import com.vahankavach.app.util.toE164Indian
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class LoginChannel { PHONE, EMAIL }

enum class LoginStep { IDENTITY, OTP }

data class LoginUiState(
    val channel: LoginChannel = LoginChannel.EMAIL,
    val step: LoginStep = LoginStep.IDENTITY,
    val phoneDisplay: String = "",
    val email: String = "",
    val e164: String? = null,
    val pendingEmail: String? = null,
    val otp: String = "",
    val busy: Boolean = false,
    val error: String? = null,
    val info: String? = null,
)

class LoginViewModel(
    private val auth: AuthRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(LoginUiState())
    val state: StateFlow<LoginUiState> = _state.asStateFlow()

    fun setChannel(channel: LoginChannel) {
        if (_state.value.busy) return
        _state.update {
            it.copy(
                channel = channel,
                step = LoginStep.IDENTITY,
                otp = "",
                error = null,
                info = null,
            )
        }
    }

    fun onPhoneChange(raw: String) {
        _state.update {
            it.copy(phoneDisplay = formatMobileInput(raw), error = null)
        }
    }

    fun onEmailChange(raw: String) {
        _state.update {
            it.copy(email = raw.trim(), error = null)
        }
    }

    fun onOtpChange(raw: String) {
        _state.update {
            it.copy(otp = raw.filter { ch -> ch.isDigit() }.take(6), error = null)
        }
    }

    fun sendOtp() {
        when (_state.value.channel) {
            LoginChannel.PHONE -> sendPhoneOtp()
            LoginChannel.EMAIL -> sendEmailOtp()
        }
    }

    private fun sendPhoneOtp() {
        val display = _state.value.phoneDisplay
        if (!isValidIndianMobile(display)) {
            _state.update { it.copy(error = "Enter a valid 10-digit Indian mobile number") }
            return
        }
        val phone = toE164Indian(display) ?: run {
            _state.update { it.copy(error = "Invalid phone number") }
            return
        }

        viewModelScope.launch {
            _state.update { it.copy(busy = true, error = null, info = null) }
            try {
                auth.sendPhoneOtp(phone)
                _state.update {
                    it.copy(
                        busy = false,
                        e164 = phone,
                        pendingEmail = null,
                        step = LoginStep.OTP,
                        info = "OTP sent via SMS. Enter the 6-digit code.",
                    )
                }
            } catch (e: Exception) {
                _state.update {
                    it.copy(
                        busy = false,
                        error = e.message
                            ?: "Failed to send SMS OTP. Check Phone Auth + Textlocal.",
                    )
                }
            }
        }
    }

    private fun sendEmailOtp() {
        val email = _state.value.email.trim().lowercase()
        if (!Patterns.EMAIL_ADDRESS.matcher(email).matches()) {
            _state.update { it.copy(error = "Enter a valid email address") }
            return
        }

        viewModelScope.launch {
            _state.update { it.copy(busy = true, error = null, info = null) }
            try {
                auth.sendEmailOtp(email)
                _state.update {
                    it.copy(
                        busy = false,
                        pendingEmail = email,
                        e164 = null,
                        step = LoginStep.OTP,
                        info = "OTP sent to email. Enter the 6-digit code from the message.",
                    )
                }
            } catch (e: Exception) {
                _state.update {
                    it.copy(
                        busy = false,
                        error = e.message
                            ?: "Failed to send email OTP. Enable Email provider in Supabase.",
                    )
                }
            }
        }
    }

    fun verifyOtp() {
        val token = _state.value.otp
        if (token.length != 6) {
            _state.update { it.copy(error = "Enter the 6-digit OTP") }
            return
        }

        when (_state.value.channel) {
            LoginChannel.PHONE -> {
                val e164 = _state.value.e164
                if (e164 == null) {
                    _state.update {
                        it.copy(
                            error = "Phone session expired. Re-enter your number.",
                            step = LoginStep.IDENTITY,
                        )
                    }
                    return
                }
                viewModelScope.launch {
                    _state.update { it.copy(busy = true, error = null) }
                    try {
                        auth.verifyPhoneOtp(e164, token)
                        _state.update { it.copy(busy = false) }
                    } catch (e: Exception) {
                        _state.update {
                            it.copy(busy = false, error = e.message ?: "Invalid OTP")
                        }
                    }
                }
            }
            LoginChannel.EMAIL -> {
                val email = _state.value.pendingEmail
                if (email == null) {
                    _state.update {
                        it.copy(
                            error = "Email session expired. Re-enter your email.",
                            step = LoginStep.IDENTITY,
                        )
                    }
                    return
                }
                viewModelScope.launch {
                    _state.update { it.copy(busy = true, error = null) }
                    try {
                        auth.verifyEmailOtp(email, token)
                        _state.update { it.copy(busy = false) }
                    } catch (e: Exception) {
                        _state.update {
                            it.copy(busy = false, error = e.message ?: "Invalid OTP")
                        }
                    }
                }
            }
        }
    }

    fun backToIdentity() {
        _state.update {
            it.copy(step = LoginStep.IDENTITY, otp = "", info = null, error = null)
        }
    }

    companion object {
        fun factory(auth: AuthRepository): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    LoginViewModel(auth) as T
            }
    }
}
