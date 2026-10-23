package com.vahankavach.app.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val Safety = Color(0xFF10B981)
val Emergency = Color(0xFFEF4444)
val AmberWarn = Color(0xFFF59E0B)
val Zinc950 = Color(0xFF09090B)
val Zinc900 = Color(0xFF18181B)
val Zinc800 = Color(0xFF27272A)
val Zinc400 = Color(0xFFA1A1AA)
val Zinc50 = Color(0xFFFAFAFA)

private val DarkColors = darkColorScheme(
    primary = Safety,
    onPrimary = Zinc950,
    secondary = AmberWarn,
    background = Zinc950,
    surface = Zinc900,
    onBackground = Zinc50,
    onSurface = Zinc50,
    error = Emergency,
    outline = Zinc800,
)

@Composable
fun VahanKavachTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = DarkColors,
        content = content,
    )
}
