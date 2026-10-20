package com.vahankavach.app.data

import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.OtpType
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.providers.builtin.OTP
import io.github.jan.supabase.auth.status.SessionStatus
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

class AuthRepository(private val supabase: SupabaseClient) {

    val sessionStatus: Flow<SessionStatus> = supabase.auth.sessionStatus

    val isSignedIn: Flow<Boolean> = sessionStatus.map { status ->
        status is SessionStatus.Authenticated
    }

    fun currentUserId(): String? = supabase.auth.currentUserOrNull()?.id

    suspend fun sendPhoneOtp(e164: String) {
        supabase.auth.signInWith(OTP) {
            phone = e164
        }
    }

    suspend fun verifyPhoneOtp(e164: String, token: String) {
        supabase.auth.verifyPhoneOtp(
            type = OtpType.Phone.SMS,
            phone = e164,
            token = token,
        )
    }

    suspend fun sendEmailOtp(email: String) {
        supabase.auth.signInWith(OTP) {
            this.email = email
        }
    }

    suspend fun verifyEmailOtp(email: String, token: String) {
        supabase.auth.verifyEmailOtp(
            type = OtpType.Email.EMAIL,
            email = email,
            token = token,
        )
    }

    suspend fun signOut() {
        supabase.auth.signOut()
    }
}
