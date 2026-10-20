package com.vahankavach.app.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

enum class NotificationChannel {
    TELEGRAM, WHATSAPP, SIGNAL
}

@Serializable
data class Profile(
    val id: String,
    @SerialName("phone_number") val phoneNumber: String? = null,
    @SerialName("full_name") val fullName: String? = null,
    val city: String? = null,
    @SerialName("is_pro") val isPro: Boolean = false,
    @SerialName("preferred_channel") val preferredChannel: String = "TELEGRAM",
    @SerialName("telegram_chat_id") val telegramChatId: String? = null,
    @SerialName("telegram_link_token") val telegramLinkToken: String? = null,
    @SerialName("signal_number") val signalNumber: String? = null,
) {
    fun channel(): NotificationChannel =
        runCatching { NotificationChannel.valueOf(preferredChannel) }
            .getOrDefault(NotificationChannel.TELEGRAM)
}

@Serializable
data class Vehicle(
    val id: String,
    @SerialName("user_id") val userId: String,
    @SerialName("reg_number") val regNumber: String,
    @SerialName("chassis_last_5") val chassisLast5: String? = null,
    @SerialName("maker_model") val makerModel: String? = null,
    @SerialName("fuel_type") val fuelType: String? = null,
    @SerialName("puc_expiry_date") val pucExpiryDate: String? = null,
    @SerialName("insurance_expiry_date") val insuranceExpiryDate: String? = null,
    @SerialName("fitness_expiry_date") val fitnessExpiryDate: String? = null,
    @SerialName("fastag_status") val fastagStatus: String? = null,
    @SerialName("fastag_bank") val fastagBank: String? = null,
    @SerialName("last_polled_at") val lastPolledAt: String? = null,
)

@Serializable
data class Challan(
    val id: String,
    @SerialName("vehicle_id") val vehicleId: String,
    @SerialName("challan_number") val challanNumber: String,
    val amount: Double,
    @SerialName("violation_date") val violationDate: String? = null,
    @SerialName("violation_type") val violationType: String? = null,
    val location: String? = null,
    @SerialName("evidence_url") val evidenceUrl: String? = null,
    val status: String = "UNPAID",
    @SerialName("payment_ref") val paymentRef: String? = null,
)

data class VehicleWithChallans(
    val vehicle: Vehicle,
    val challans: List<Challan>,
) {
    val unpaid: List<Challan> get() = challans.filter { it.status == "UNPAID" }
    val unpaidTotal: Double get() = unpaid.sumOf { it.amount }
}

@Serializable
data class SyncVehicleRequest(
    val regNumber: String,
    val forceRefresh: Boolean = false,
)

@Serializable
data class SyncVehicleApiResponse(
    val success: Boolean,
    val data: SyncVehicleData? = null,
    val error: String? = null,
)

@Serializable
data class SyncVehicleData(
    val source: String? = null,
)

@Serializable
data class ProfileChannelUpdate(
    @SerialName("preferred_channel") val preferredChannel: String,
)

@Serializable
data class TelegramLinkUpdate(
    @SerialName("telegram_link_token") val telegramLinkToken: String? = null,
    @SerialName("telegram_chat_id") val telegramChatId: String? = null,
)
