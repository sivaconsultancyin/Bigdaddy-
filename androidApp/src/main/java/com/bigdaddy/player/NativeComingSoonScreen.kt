package com.bigdaddy.player

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

@Composable
internal fun NativeComingSoonScreen(
    title: String,
    subtitle: String,
    symbol: String,
    status: String,
    architectureTitle: String,
    description: String,
    poolBalance: String,
    minBet: String,
    maxBet: String,
    onBack: () -> Unit
) {
    Column(
        Modifier.fillMaxSize().padding(horizontal = 2.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        TextButton(onClick = onBack) {
            Text("‹  Back to Lobby", color = Color(0xFFD4D4D8), fontWeight = FontWeight.SemiBold)
        }
        Card(
            Modifier.fillMaxWidth().border(1.dp, Color(0x66F59E0B), RoundedCornerShape(18.dp)),
            shape = RoundedCornerShape(18.dp),
            colors = CardDefaults.cardColors(containerColor = Color(0xFF09090B))
        ) {
            Column(
                Modifier.fillMaxWidth().background(
                    Brush.linearGradient(
                        listOf(Color(0xFF21170A), Color(0xFF09090B), Color(0xFF111113))
                    )
                ).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Column(
                        Modifier.size(48.dp).background(Color(0x33F59E0B), RoundedCornerShape(12.dp)),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center
                    ) {
                        Text(symbol, style = MaterialTheme.typography.headlineMedium)
                    }
                    Column(Modifier.weight(1f)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(title, color = Color(0xFFFCDFA0), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Black)
                            Text("COMING SOON", color = Color(0xFFFFD27A), style = MaterialTheme.typography.labelSmall,
                                modifier = Modifier.background(Color(0x33F59E0B), RoundedCornerShape(6.dp)).padding(horizontal = 6.dp, vertical = 3.dp))
                        }
                        Text(subtitle, color = Color(0xFFA1A1AA), style = MaterialTheme.typography.bodySmall)
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    InfoTile("STATUS", status, Modifier.weight(1f))
                    InfoTile("AVAILABILITY", "Preview only", Modifier.weight(1f))
                }
                InfoTile("GAME POOL", poolBalance.ifBlank { "Unavailable" }, Modifier.weight(1f))
                InfoTile("CHIP LIMITS", if (minBet.isNotBlank() && maxBet.isNotBlank()) "$minBet - $maxBet Tokens" else "Unavailable", Modifier.weight(1f))
                Column(
                    Modifier.fillMaxWidth().background(Color(0x9918181B), RoundedCornerShape(12.dp))
                        .border(1.dp, Color(0xFF27272A), RoundedCornerShape(12.dp)).padding(12.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Text(architectureTitle, color = Color(0xFFF4F4F5), fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleSmall)
                    Text(description, color = Color(0xFFA1A1AA), style = MaterialTheme.typography.bodySmall)
                }
                Spacer(Modifier.height(2.dp))
                Text("This screen is a preview, not a playable round. No local random result or wallet transaction is generated.",
                    color = Color(0xFF71717A), style = MaterialTheme.typography.labelSmall)
            }
        }
    }
}

@Composable
private fun InfoTile(label: String, value: String, modifier: Modifier = Modifier) {
    Column(
        modifier.background(Color(0xFF18181B), RoundedCornerShape(10.dp))
            .border(1.dp, Color(0xFF27272A), RoundedCornerShape(10.dp)).padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        Text(label, color = Color(0xFF71717A), style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
        Text(value, color = Color(0xFFFCDFA0), style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Bold)
    }
}
