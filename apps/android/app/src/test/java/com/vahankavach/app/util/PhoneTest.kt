package com.vahankavach.app.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PhoneTest {
    @Test
    fun validIndianMobile() {
        assertTrue(isValidIndianMobile("9876543210"))
        assertTrue(isValidIndianMobile("+91 98765 43210"))
        assertTrue(isValidIndianMobile("919876543210"))
        assertFalse(isValidIndianMobile("5876543210"))
        assertFalse(isValidIndianMobile("98765"))
    }

    @Test
    fun toE164() {
        assertEquals("+919876543210", toE164Indian("98765 43210"))
        assertNull(toE164Indian("123"))
    }

    @Test
    fun formatInput() {
        assertEquals("98765 43210", formatMobileInput("9876543210"))
    }
}
