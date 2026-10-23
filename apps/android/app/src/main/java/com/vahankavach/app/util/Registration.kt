package com.vahankavach.app.util

private val REG_PATTERN = Regex("^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$")

fun sanitizeRegInput(raw: String): String =
    raw.filter { it.isLetterOrDigit() }.uppercase()

fun isValidRegNumber(raw: String): Boolean =
    REG_PATTERN.matches(sanitizeRegInput(raw))

fun toStoredRegNumber(raw: String): String? {
    val sanitized = sanitizeRegInput(raw)
    return if (REG_PATTERN.matches(sanitized)) sanitized else null
}

/** Progressive display mask: KA01AB1234 → KA 01 AB 1234 */
fun formatRegDisplay(raw: String): String {
    val s = sanitizeRegInput(raw).take(11)
    if (s.isEmpty()) return ""

    val state = s.take(2)
    val rest = s.drop(2)

    var rto = ""
    var afterRto = ""
    for (i in rest.indices) {
        val ch = rest[i]
        if (ch.isDigit() && rto.length < 2 && afterRto.isEmpty()) {
            rto += ch
        } else {
            afterRto = rest.substring(i)
            break
        }
    }

    var series = ""
    var number = ""
    for (ch in afterRto) {
        when {
            ch.isLetter() && number.isEmpty() && series.length < 3 -> series += ch
            ch.isDigit() && number.length < 4 -> number += ch
        }
    }

    return listOfNotNull(
        state.ifEmpty { null },
        rto.ifEmpty { null },
        series.ifEmpty { null },
        number.ifEmpty { null },
    ).joinToString(" ")
}
