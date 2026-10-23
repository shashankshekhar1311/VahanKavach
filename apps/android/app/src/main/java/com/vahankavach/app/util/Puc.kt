package com.vahankavach.app.util

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

enum class PucLevel { GREEN, AMBER, RED }

fun daysUntil(dateIso: String?): Int? {
    if (dateIso.isNullOrBlank()) return null
    return try {
        val target = LocalDate.parse(dateIso.take(10))
        val today = LocalDate.now(ZoneOffset.UTC)
        (target.toEpochDay() - today.toEpochDay()).toInt()
    } catch (_: Exception) {
        null
    }
}

fun pucLevel(daysRemaining: Int?): PucLevel = when {
    daysRemaining == null || daysRemaining <= 0 -> PucLevel.RED
    daysRemaining <= 15 -> PucLevel.AMBER
    else -> PucLevel.GREEN
}

fun formatExpiryLabel(dateIso: String?): String {
    if (dateIso.isNullOrBlank()) return "Not available"
    return try {
        val d = LocalDate.parse(dateIso.take(10))
        d.format(DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH))
    } catch (_: Exception) {
        dateIso
    }
}

fun formatInr(amount: Double): String {
    val nf = java.text.NumberFormat.getCurrencyInstance(Locale("en", "IN"))
    nf.maximumFractionDigits = if (amount % 1.0 == 0.0) 0 else 2
    return nf.format(amount)
}

fun formatViolationDate(iso: String?): String {
    if (iso.isNullOrBlank()) return "Date unknown"
    return try {
        val instant = Instant.parse(
            if (iso.length == 10) "${iso}T00:00:00Z" else iso,
        )
        DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH)
            .withZone(ZoneOffset.UTC)
            .format(instant)
    } catch (_: Exception) {
        iso.take(10)
    }
}
