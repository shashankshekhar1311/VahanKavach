package com.vahankavach.app.data

import com.vahankavach.app.BuildConfig
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.query.Order
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.android.Android
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.serialization.kotlinx.json.json
import kotlin.random.Random
import kotlinx.serialization.json.Json

class GarageRepository(private val supabase: SupabaseClient) {

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        encodeDefaults = true
    }

    private val http = HttpClient(Android) {
        install(ContentNegotiation) {
            json(json)
        }
    }

    private fun requireUserId(): String =
        supabase.auth.currentUserOrNull()?.id
            ?: error("Not signed in")

    suspend fun fetchProfile(): Profile? {
        val userId = requireUserId()
        val rows = supabase.from("profiles")
            .select(
                Columns.list(
                    "id",
                    "phone_number",
                    "full_name",
                    "city",
                    "is_pro",
                    "preferred_channel",
                    "telegram_chat_id",
                    "telegram_link_token",
                    "signal_number",
                ),
            ) {
                filter { eq("id", userId) }
                limit(1)
            }
            .decodeList<Profile>()
        return rows.firstOrNull()
    }

    suspend fun fetchGarage(): List<VehicleWithChallans> {
        val userId = requireUserId()
        val vehicles = supabase.from("vehicles")
            .select() {
                filter { eq("user_id", userId) }
                order("created_at", Order.ASCENDING)
            }
            .decodeList<Vehicle>()

        if (vehicles.isEmpty()) return emptyList()

        val ids = vehicles.map { it.id }
        val challans = supabase.from("challans")
            .select() {
                filter { isIn("vehicle_id", ids) }
            }
            .decodeList<Challan>()

        return vehicles.map { v ->
            VehicleWithChallans(
                vehicle = v,
                challans = challans.filter { it.vehicleId == v.id },
            )
        }
    }

    suspend fun releaseVehicle(vehicleId: String) {
        supabase.from("vehicles").delete {
            filter { eq("id", vehicleId) }
        }
    }

    suspend fun syncVehicle(
        regNumber: String,
        forceRefresh: Boolean = false,
        mode: String? = null,
        chassisLast5: String? = null,
    ): SyncVehicleApiResponse {
        val accessToken = supabase.auth.currentSessionOrNull()?.accessToken
            ?: error("Not signed in")
        val base = BuildConfig.SUPABASE_URL.trimEnd('/')
        return http.post("$base/functions/v1/sync-vehicle") {
            header("Authorization", "Bearer $accessToken")
            header("apikey", BuildConfig.SUPABASE_ANON_KEY)
            contentType(ContentType.Application.Json)
            setBody(
                SyncVehicleRequest(
                    regNumber = regNumber,
                    forceRefresh = forceRefresh,
                    mode = mode,
                    chassisLast5 = chassisLast5,
                ),
            )
        }.body()
    }

    suspend fun setPreferredChannel(channel: NotificationChannel) {
        val userId = requireUserId()
        supabase.from("profiles").update(
            ProfileChannelUpdate(preferredChannel = channel.name),
        ) {
            filter { eq("id", userId) }
        }
    }

    suspend fun ensureTelegramLinkToken(): String {
        val profile = fetchProfile() ?: error("Profile not found")
        profile.telegramLinkToken?.takeIf { it.isNotBlank() }?.let { return it }

        val token = randomLinkToken()
        val userId = requireUserId()
        supabase.from("profiles").update(
            TelegramLinkUpdate(telegramLinkToken = token),
        ) {
            filter { eq("id", userId) }
        }
        return token
    }

    suspend fun unlinkTelegram() {
        val userId = requireUserId()
        supabase.from("profiles").update(
            TelegramLinkUpdate(telegramLinkToken = null, telegramChatId = null),
        ) {
            filter { eq("id", userId) }
        }
    }

    private fun randomLinkToken(): String {
        val bytes = ByteArray(24)
        Random.Default.nextBytes(bytes)
        return bytes.joinToString("") { b -> "%02x".format(b) }
    }
}
