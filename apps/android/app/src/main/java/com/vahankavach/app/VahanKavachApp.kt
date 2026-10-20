package com.vahankavach.app

import android.app.Application
import com.vahankavach.app.data.AuthRepository
import com.vahankavach.app.data.GarageRepository
import com.vahankavach.app.data.SupabaseProvider

class VahanKavachApp : Application() {
    lateinit var authRepository: AuthRepository
        private set
    lateinit var garageRepository: GarageRepository
        private set

    override fun onCreate() {
        super.onCreate()
        val client = SupabaseProvider.get(this)
        authRepository = AuthRepository(client)
        garageRepository = GarageRepository(client)
    }
}
