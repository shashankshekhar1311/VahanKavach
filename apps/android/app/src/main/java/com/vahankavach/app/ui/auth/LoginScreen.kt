package com.vahankavach.app.ui.auth

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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.vahankavach.app.ui.theme.Safety
import com.vahankavach.app.ui.theme.Zinc400
import com.vahankavach.app.ui.theme.Zinc800
import com.vahankavach.app.ui.theme.Zinc900
import com.vahankavach.app.ui.theme.Zinc950

@Composable
fun LoginScreen(viewModel: LoginViewModel) {
    val state by viewModel.state.collectAsState()

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Zinc950)
            .padding(24.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .align(Alignment.Center),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(56.dp)
                    .background(Safety.copy(alpha = 0.15f), RoundedCornerShape(16.dp)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Default.Shield, contentDescription = null, tint = Safety, modifier = Modifier.size(28.dp))
            }
            Text(
                "VahanKavach",
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Bold,
            )
            Text(
                "Your Automated Vehicle Shield",
                color = Zinc400,
                style = MaterialTheme.typography.bodyMedium,
            )

            if (state.step == LoginStep.IDENTITY) {
                ChannelToggle(
                    selected = state.channel,
                    enabled = !state.busy,
                    onSelect = viewModel::setChannel,
                )
            }

            when (state.step) {
                LoginStep.IDENTITY -> {
                    when (state.channel) {
                        LoginChannel.EMAIL -> {
                            OutlinedTextField(
                                value = state.email,
                                onValueChange = viewModel::onEmailChange,
                                modifier = Modifier.fillMaxWidth(),
                                label = { Text("Email") },
                                placeholder = { Text("you@example.com") },
                                singleLine = true,
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                                enabled = !state.busy,
                            )
                        }
                        LoginChannel.PHONE -> {
                            OutlinedTextField(
                                value = state.phoneDisplay,
                                onValueChange = viewModel::onPhoneChange,
                                modifier = Modifier.fillMaxWidth(),
                                label = { Text("Mobile (+91)") },
                                prefix = { Text("+91  ") },
                                singleLine = true,
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                                enabled = !state.busy,
                            )
                        }
                    }
                    Button(
                        onClick = viewModel::sendOtp,
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                        enabled = !state.busy,
                    ) {
                        if (state.busy) {
                            CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = Zinc950)
                        } else {
                            Text(
                                if (state.channel == LoginChannel.EMAIL) {
                                    "Send email OTP"
                                } else {
                                    "Send SMS OTP"
                                },
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                    }
                }
                LoginStep.OTP -> {
                    val destination = state.pendingEmail ?: state.e164 ?: ""
                    Text(
                        "Code sent to $destination",
                        color = Zinc400,
                        style = MaterialTheme.typography.bodySmall,
                    )
                    OutlinedTextField(
                        value = state.otp,
                        onValueChange = viewModel::onOtpChange,
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("6-digit OTP") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                        enabled = !state.busy,
                    )
                    Button(
                        onClick = viewModel::verifyOtp,
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                        enabled = !state.busy,
                    ) {
                        if (state.busy) {
                            CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = Zinc950)
                        } else {
                            Text("Verify & continue", fontWeight = FontWeight.SemiBold)
                        }
                    }
                    TextButton(onClick = viewModel::backToIdentity, enabled = !state.busy) {
                        Text(
                            if (state.channel == LoginChannel.EMAIL) {
                                "Change email"
                            } else {
                                "Change number"
                            },
                        )
                    }
                }
            }

            state.info?.let {
                Text(it, color = Safety, style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center)
            }
            state.error?.let {
                Text(
                    it,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                    textAlign = TextAlign.Center,
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(Zinc800.copy(alpha = 0.5f), RoundedCornerShape(8.dp))
                        .padding(12.dp),
                )
            }

            Text(
                "Email OTP uses Supabase Auth email. SMS uses Phone + Textlocal when delivery works.",
                color = Zinc400.copy(alpha = 0.7f),
                style = MaterialTheme.typography.labelSmall,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 8.dp),
            )
        }
    }
}

@Composable
private fun ChannelToggle(
    selected: LoginChannel,
    enabled: Boolean,
    onSelect: (LoginChannel) -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(Zinc900, RoundedCornerShape(12.dp))
            .border(1.dp, Zinc800, RoundedCornerShape(12.dp))
            .padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        ChannelChip(
            label = "Email",
            selected = selected == LoginChannel.EMAIL,
            enabled = enabled,
            onClick = { onSelect(LoginChannel.EMAIL) },
            modifier = Modifier.weight(1f),
        )
        ChannelChip(
            label = "Phone",
            selected = selected == LoginChannel.PHONE,
            enabled = enabled,
            onClick = { onSelect(LoginChannel.PHONE) },
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun ChannelChip(
    label: String,
    selected: Boolean,
    enabled: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .background(
                if (selected) Safety.copy(alpha = 0.2f) else Zinc950,
                RoundedCornerShape(10.dp),
            )
            .clickable(enabled = enabled, onClick = onClick)
            .padding(vertical = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            color = if (selected) Safety else Zinc400,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
            style = MaterialTheme.typography.labelLarge,
        )
    }
}
