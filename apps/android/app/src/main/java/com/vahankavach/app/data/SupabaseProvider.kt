package com.vahankavach.app.data

import android.content.Context
import com.vahankavach.app.BuildConfig
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.postgrest.Postgrest
object SupabaseProvider {
    @Volatile
    private var client: SupabaseClient? = null

    fun requireConfigured() {
        check(BuildConfig.SUPABASE_URL.isNotBlank() && BuildConfig.SUPABASE_ANON_KEY.isNotBlank()) {
            "Missing SUPABASE_URL / SUPABASE_ANON_KEY. Copy apps/android/local.properties.example → local.properties."
        }
    }

    fun get(context: Context): SupabaseClient {
        requireConfigured()
        // Ensure Application context is available for Auth session persistence.
        context.applicationContext
        return client ?: synchronized(this) {
            client ?: createSupabaseClient(
                supabaseUrl = BuildConfig.SUPABASE_URL.trimEnd('/'),
                supabaseKey = BuildConfig.SUPABASE_ANON_KEY,
            ) {
                install(Auth)
                install(Postgrest)
            }.also { client = it }
        }
    }
}
