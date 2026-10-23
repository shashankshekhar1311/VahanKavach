package com.vahankavach.app.util

private val INDIAN_MOBILE = Regex("^[6-9]\\d{9}$")

fun extractIndianMobileDigits(raw: String): String {
    val digits = raw.filter { it.isDigit() }
    return when {
        digits.length == 12 && digits.startsWith("91") -> digits.drop(2)
        digits.length == 11 && digits.startsWith("0") -> digits.drop(1)
        else -> digits.take(10)
    }
}

fun isValidIndianMobile(raw: String): Boolean =
    INDIAN_MOBILE.matches(extractIndianMobileDigits(raw))

/** E.164 for Supabase Auth: +919876543210 */
fun toE164Indian(raw: String): String? {
    val mobile = extractIndianMobileDigits(raw)
    if (!INDIAN_MOBILE.matches(mobile)) return null
    return "+91$mobile"
}

fun formatMobileInput(raw: String): String {
    val digits = extractIndianMobileDigits(raw)
    return if (digits.length <= 5) digits else "${digits.take(5)} ${digits.drop(5)}"
}

fun formatPhoneDisplay(e164: String?): String {
    if (e164.isNullOrBlank()) return "—"
    val digits = e164.filter { it.isDigit() }
    return if (digits.length == 12 && digits.startsWith("91")) {
        "+91 ${digits.substring(2, 7)} ${digits.substring(7)}"
    } else {
        e164
    }
}
