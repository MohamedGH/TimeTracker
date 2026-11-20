package com.timetracker.carnetdutemps.tiles

import android.app.KeyguardManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Handles the "Arrêter" action directly from the lock-screen / shade chronometer notification.
 */
class QuickTimerNotificationReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != ACTION_STOP_ACTIVE_TIMER) return

        val config = QuickTimerRepository.getConfig(context)
        if (!config.allowOnLockScreen) {
            val km = context.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
            if (km?.isDeviceLocked == true) {
                // On API < 31 where Action.Builder.setAuthenticationRequired is unavailable,
                // keep timer intact on locked screen until the user unlocks.
                QuickTimerNotificationManager.syncNotification(context)
                return
            }
        }

        val stopped = QuickTimerRepository.stopActiveTimer(context)
        QuickTimerNotificationManager.syncNotification(context)
        if (stopped != null) {
            QuickTimerTileRegistry.refreshAllTiles(context)
            QuickTimerTilesPlugin.notifyNativeTimerChanged(context)
        }
    }

    companion object {
        const val ACTION_STOP_ACTIVE_TIMER = "com.timetracker.carnetdutemps.ACTION_STOP_ACTIVE_TIMER"
    }
}
