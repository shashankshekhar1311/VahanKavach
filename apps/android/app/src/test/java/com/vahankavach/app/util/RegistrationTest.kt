package com.vahankavach.app.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RegistrationTest {
    @Test
    fun sanitizeAndValidate() {
        assertEquals("KA01AB1234", sanitizeRegInput("ka-01-ab-1234"))
        assertTrue(isValidRegNumber("KA 01 AB 1234"))
        assertFalse(isValidRegNumber("INVALID"))
        assertEquals("KA01AB1234", toStoredRegNumber("ka01ab1234"))
        assertNull(toStoredRegNumber("KA01"))
    }

    @Test
    fun displayMask() {
        assertEquals("KA 01 AB 1234", formatRegDisplay("KA01AB1234"))
        assertEquals("KA 01", formatRegDisplay("KA01"))
    }
}
