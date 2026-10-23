package com.vahankavach.app.ui.garage

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.LinkOff
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.vahankavach.app.data.NotificationChannel
import com.vahankavach.app.data.VehicleWithChallans
import com.vahankavach.app.ui.theme.AmberWarn
import com.vahankavach.app.ui.theme.Emergency
import com.vahankavach.app.ui.theme.Safety
import com.vahankavach.app.ui.theme.Zinc400
import com.vahankavach.app.ui.theme.Zinc50
import com.vahankavach.app.ui.theme.Zinc800
import com.vahankavach.app.ui.theme.Zinc900
import com.vahankavach.app.ui.theme.Zinc950
import com.vahankavach.app.util.PucLevel
import com.vahankavach.app.util.daysUntil
import com.vahankavach.app.util.formatInr
import com.vahankavach.app.util.formatPhoneDisplay
import com.vahankavach.app.util.formatRegDisplay
import com.vahankavach.app.util.pucLevel
import kotlinx.coroutines.launch

@Composable
fun GarageScreen(viewModel: GarageViewModel) {
    val state by viewModel.state.collectAsState()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Zinc950)
            .padding(horizontal = 16.dp, vertical = 12.dp),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        "GARAGE",
                        color = Safety,
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Spacer(Modifier.size(8.dp))
                    Text(
                        state.profile?.fullName?.takeIf { it.isNotBlank() } ?: "Vehicle owner",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                    )
                }
                Text(
                    listOfNotNull(
                        state.profile?.city ?: "India",
                        formatPhoneDisplay(state.profile?.phoneNumber),
                    ).joinToString(" · "),
                    color = Zinc400,
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 1,
                )
            }
            CompactChannelChip(
                when (state.profile?.channel()) {
                    NotificationChannel.WHATSAPP -> NotificationChannel.WHATSAPP
                    else -> NotificationChannel.TELEGRAM
                },
                linked = !state.profile?.telegramChatId.isNullOrBlank(),
            )
            IconButton(onClick = viewModel::signOut) {
                Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = "Sign out", tint = Zinc400)
            }
        }

        Spacer(Modifier.height(10.dp))

        LazyColumn(
            verticalArrangement = Arrangement.spacedBy(10.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            item {
                QuickAdd(
                    regInput = state.regInput,
                    chassisInput = state.chassisInput,
                    busy = state.protecting,
                    onRegChange = viewModel::onRegInputChange,
                    onChassisChange = viewModel::onChassisInputChange,
                    onProtect = viewModel::protectVehicle,
                )
            }

            item {
                NotificationPrefs(
                    channel = when (state.profile?.channel()) {
                        NotificationChannel.WHATSAPP -> NotificationChannel.WHATSAPP
                        else -> NotificationChannel.TELEGRAM
                    },
                    linked = !state.profile?.telegramChatId.isNullOrBlank(),
                    busy = state.channelBusy,
                    onSelect = viewModel::setChannel,
                    onConnectTelegram = {
                        scope.launch {
                            try {
                                val url = viewModel.connectTelegramDeepLink()
                                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                            } catch (_: Exception) {
                                // surfaced via refresh of profile / banner on next ops
                            }
                        }
                    },
                    onUnlink = viewModel::unlinkTelegram,
                )
            }

            item {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("Your vehicles", fontWeight = FontWeight.SemiBold, color = Zinc400)
                    TextButton(
                        onClick = viewModel::refreshAll,
                        enabled = !state.loading && !state.protecting,
                    ) {
                        Icon(Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(14.dp))
                        Text(" Refresh all", style = MaterialTheme.typography.labelMedium)
                    }
                }
            }

            state.banner?.let { banner ->
                item {
                    Text(
                        banner,
                        color = Zinc400,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(Zinc900, RoundedCornerShape(8.dp))
                            .border(1.dp, Zinc800, RoundedCornerShape(8.dp))
                            .padding(12.dp),
                    )
                }
            }
            state.error?.let { err ->
                item {
                    Text(
                        err,
                        color = Emergency,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(Zinc900, RoundedCornerShape(8.dp))
                            .padding(12.dp),
                    )
                }
            }

            when {
                state.loading -> item {
                    Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(color = Safety)
                    }
                }
                state.vehicles.isEmpty() -> item {
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .border(1.dp, Zinc800, RoundedCornerShape(16.dp))
                            .padding(32.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text("No vehicles yet", fontWeight = FontWeight.Medium)
                            Text("Enter a registration above to start protection.", color = Zinc400, style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
                else -> items(state.vehicles, key = { it.vehicle.id }) { item ->
                    VehicleCard(
                        item = item,
                        refreshing = state.refreshingReg == item.vehicle.regNumber,
                        onRefresh = { viewModel.refreshVehicle(item.vehicle.regNumber) },
                        onRelease = {
                            viewModel.releaseVehicle(item.vehicle.id, item.vehicle.regNumber)
                        },
                    )
                }
            }

            item { Spacer(Modifier.height(24.dp)) }
        }
    }
}

@Composable
private fun CompactChannelChip(channel: NotificationChannel, linked: Boolean) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        modifier = Modifier
            .background(Safety.copy(alpha = 0.1f), CircleShape)
            .border(1.dp, Safety.copy(alpha = 0.25f), CircleShape)
            .padding(horizontal = 8.dp, vertical = 4.dp),
    ) {
        Box(
            Modifier
                .size(6.dp)
                .background(if (linked) Safety else Zinc400, CircleShape),
        )
        Text(
            channel.name.lowercase().replaceFirstChar { it.titlecase() },
            color = Safety,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Medium,
        )
    }
}

@Composable
private fun QuickAdd(
    regInput: String,
    chassisInput: String,
    busy: Boolean,
    onRegChange: (String) -> Unit,
    onChassisChange: (String) -> Unit,
    onProtect: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .background(Zinc900, RoundedCornerShape(12.dp))
            .border(1.dp, Zinc800, RoundedCornerShape(12.dp))
            .padding(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedTextField(
                value = formatRegDisplay(regInput),
                onValueChange = onRegChange,
                modifier = Modifier.weight(1f),
                placeholder = { Text("KA 01 AB 1234") },
                singleLine = true,
                enabled = !busy,
            )
            OutlinedTextField(
                value = chassisInput,
                onValueChange = onChassisChange,
                modifier = Modifier.width(96.dp),
                placeholder = { Text("×5") },
                label = { Text("Chassis") },
                singleLine = true,
                enabled = !busy,
            )
            Button(
                onClick = onProtect,
                modifier = Modifier.height(52.dp),
                enabled = !busy && chassisInput.length == 5,
            ) {
                if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = Zinc950)
                else Text("Protect", fontWeight = FontWeight.SemiBold)
            }
        }
        Text(
            "Ownership proof: last 5 of chassis from RC (mock KA01AB1234 → A1B2C).",
            color = Zinc400,
            style = MaterialTheme.typography.labelSmall,
        )
    }
}

@Composable
private fun NotificationPrefs(
    channel: NotificationChannel,
    linked: Boolean,
    busy: Boolean,
    onSelect: (NotificationChannel) -> Unit,
    onConnectTelegram: () -> Unit,
    onUnlink: () -> Unit,
) {
    val visibleChannels = listOf(NotificationChannel.TELEGRAM, NotificationChannel.WHATSAPP)

    Column(
        Modifier
            .fillMaxWidth()
            .background(Zinc900.copy(alpha = 0.7f), RoundedCornerShape(12.dp))
            .border(1.dp, Zinc800, RoundedCornerShape(12.dp))
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                "ALERTS",
                color = Zinc400,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Medium,
            )
            Row(
                Modifier
                    .weight(1f)
                    .background(Zinc950.copy(alpha = 0.6f), RoundedCornerShape(8.dp))
                    .border(1.dp, Zinc800, RoundedCornerShape(8.dp))
                    .padding(2.dp),
                horizontalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                visibleChannels.forEach { c ->
                    val enabled = c != NotificationChannel.WHATSAPP
                    val selected = c == channel && enabled
                    Row(
                        Modifier
                            .weight(1f)
                            .background(
                                if (selected) Safety.copy(alpha = 0.15f) else Zinc950.copy(alpha = 0f),
                                RoundedCornerShape(6.dp),
                            )
                            .clickable(enabled = !busy && enabled) { onSelect(c) }
                            .padding(vertical = 6.dp),
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        if (selected) {
                            Icon(
                                Icons.Default.Check,
                                null,
                                Modifier.size(12.dp),
                                tint = Safety,
                            )
                            Spacer(Modifier.size(4.dp))
                        }
                        Text(
                            c.name.lowercase().replaceFirstChar { it.titlecase() },
                            fontWeight = FontWeight.SemiBold,
                            style = MaterialTheme.typography.labelSmall,
                            color = when {
                                !enabled -> Zinc400.copy(alpha = 0.45f)
                                selected -> Safety
                                else -> Zinc400
                            },
                        )
                    }
                }
            }
        }

        if (channel == NotificationChannel.TELEGRAM) {
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    if (linked) "Telegram linked" else "Connect bot for alerts",
                    color = Zinc400,
                    style = MaterialTheme.typography.labelSmall,
                )
                if (linked) {
                    TextButton(onClick = onUnlink, enabled = !busy) { Text("Unlink") }
                } else {
                    TextButton(onClick = onConnectTelegram, enabled = !busy) {
                        Icon(Icons.AutoMirrored.Filled.OpenInNew, null, Modifier.size(14.dp))
                        Text(" Connect")
                    }
                }
            }
        }
    }
}

@Composable
private fun VehicleCard(
    item: VehicleWithChallans,
    refreshing: Boolean,
    onRefresh: () -> Unit,
    onRelease: () -> Unit,
) {
    val v = item.vehicle
    val insuranceDays = daysUntil(v.insuranceExpiryDate)
    val pucDays = daysUntil(v.pucExpiryDate)
    val fitnessDays = daysUntil(v.fitnessExpiryDate)
    val unpaidCount = item.unpaid.size

    Column(
        Modifier
            .fillMaxWidth()
            .background(Zinc900.copy(alpha = 0.85f), RoundedCornerShape(16.dp))
            .border(1.dp, if (refreshing) Safety.copy(alpha = 0.4f) else Zinc800, RoundedCornerShape(16.dp))
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Column(Modifier.weight(1f)) {
                Text(v.makerModel ?: "Unknown vehicle", fontWeight = FontWeight.SemiBold, maxLines = 1)
                Text(
                    formatRegDisplay(v.regNumber),
                    color = Zinc400,
                    fontFamily = FontFamily.Monospace,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            Row {
                IconButton(onClick = onRefresh, enabled = !refreshing) {
                    if (refreshing) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = Safety)
                    else Icon(Icons.Default.Refresh, "Refresh", tint = Zinc400)
                }
                IconButton(onClick = onRelease, enabled = !refreshing) {
                    Icon(Icons.Default.LinkOff, "Release vehicle", tint = Zinc400)
                }
            }
        }

        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            ComplianceMetric(
                label = "Ins",
                value = shortExpiry(v.insuranceExpiryDate),
                hint = daysHint(insuranceDays),
                tone = toneFromDays(insuranceDays),
                modifier = Modifier.weight(1f),
            )
            ComplianceMetric(
                label = "PUC",
                value = shortExpiry(v.pucExpiryDate),
                hint = daysHint(pucDays),
                tone = toneFromDays(pucDays),
                modifier = Modifier.weight(1f),
            )
            ComplianceMetric(
                label = "Challan",
                value = if (unpaidCount == 0) "Clear" else unpaidCount.toString(),
                hint = if (unpaidCount == 0) "None due" else formatInr(item.unpaidTotal),
                tone = when {
                    unpaidCount > 0 -> PucLevel.RED
                    else -> PucLevel.GREEN
                },
                modifier = Modifier.weight(1f),
            )
            ComplianceMetric(
                label = "Fit",
                value = shortExpiry(v.fitnessExpiryDate),
                hint = daysHint(fitnessDays),
                tone = toneFromDays(fitnessDays),
                modifier = Modifier.weight(1f),
            )
        }
    }
}

private fun shortExpiry(dateIso: String?): String {
    if (dateIso.isNullOrBlank()) return "—"
    return try {
        val d = java.time.LocalDate.parse(dateIso.take(10))
        d.format(java.time.format.DateTimeFormatter.ofPattern("d MMM", java.util.Locale.ENGLISH))
    } catch (_: Exception) {
        "—"
    }
}

private fun daysHint(days: Int?): String = when {
    days == null -> "N/A"
    days < 0 -> "${-days}d late"
    days == 0 -> "Today"
    else -> "${days}d"
}

private fun toneFromDays(days: Int?): PucLevel = pucLevel(days)

@Composable
private fun ComplianceMetric(
    label: String,
    value: String,
    hint: String,
    tone: PucLevel,
    modifier: Modifier = Modifier,
) {
    val toneColor = when (tone) {
        PucLevel.GREEN -> Safety
        PucLevel.AMBER -> AmberWarn
        PucLevel.RED -> Emergency
    }
    val muted = value == "—" || hint == "N/A"
    val accent = if (muted && tone != PucLevel.RED) Zinc400 else toneColor

    Column(
        modifier
            .background(accent.copy(alpha = 0.08f), RoundedCornerShape(8.dp))
            .border(1.dp, accent.copy(alpha = 0.22f), RoundedCornerShape(8.dp))
            .padding(horizontal = 4.dp, vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            Box(Modifier.size(4.dp).background(accent, CircleShape))
            Text(
                label.uppercase(),
                color = Zinc400,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.SemiBold,
            )
        }
        Text(
            value,
            color = accent,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
        )
        Text(
            hint,
            color = Zinc400,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 1,
        )
    }
}
