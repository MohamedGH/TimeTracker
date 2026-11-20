package com.timetracker.carnetdutemps.tiles

import android.app.PendingIntent
import android.content.Intent
import android.graphics.drawable.Icon
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import androidx.annotation.RequiresApi
import com.timetracker.carnetdutemps.MainActivity
import com.timetracker.carnetdutemps.R

/**
 * Base TileService handling independent Quick Settings tiles per slot.
 * Works directly on the lock screen without launching TimeTracker when allowed
 * by the device OS and user settings.
 */
@RequiresApi(Build.VERSION_CODES.N)
abstract class BaseQuickTimerTileService(
    private val slotNumber: Int,
) : TileService(), QuickTimerTileRegistry.RefreshableQuickTile {

    override fun onTileAdded() {
        super.onTileAdded()
        refreshTileVisualState()
    }

    override fun onStartListening() {
        super.onStartListening()
        QuickTimerTileRegistry.registerListeningTile(this)
        QuickTimerNotificationManager.ensureChannel(this)
        refreshTileVisualState()
    }

    override fun onStopListening() {
        QuickTimerTileRegistry.unregisterListeningTile(this)
        super.onStopListening()
    }

    override fun onDestroy() {
        QuickTimerTileRegistry.unregisterListeningTile(this)
        super.onDestroy()
    }

    override fun refreshFromRepository() {
        refreshTileVisualState()
    }

    override fun onClick() {
        super.onClick()
        val config = QuickTimerRepository.getConfig(this)
        val slotConfig = config.slotFor(slotNumber)
        val activityName = slotConfig.activity?.trim()?.ifEmpty { null }

        if (activityName == null) {
            // Unconfigured tile requires opening the in-app configuration screen.
            val openConfigTask = Runnable { launchMainActivityForConfig(slotNumber) }
            if (isLocked) {
                unlockAndRun(openConfigTask)
            } else {
                openConfigTask.run()
            }
            return
        }

        if (isLocked && !config.allowOnLockScreen) {
            // Respect user preference to require unlock before toggling timers on lock screen.
            unlockAndRun { toggleSlotAndRefreshAll() }
            return
        }

        // Primary path: direct atomic start/stop/switch without opening app or requiring unlock.
        toggleSlotAndRefreshAll()
    }

    private fun toggleSlotAndRefreshAll() {
        QuickTimerRepository.toggleSlot(this, slotNumber)
        QuickTimerNotificationManager.syncNotification(this)
        refreshTileVisualState()
        QuickTimerTileRegistry.refreshAllTiles(this)
        QuickTimerTilesPlugin.notifyNativeTimerChanged(this)
    }

    private fun refreshTileVisualState() {
        val tile = qsTile ?: return
        val config = QuickTimerRepository.getConfig(this)
        val slotConfig = config.slotFor(slotNumber)
        val activeTimer = QuickTimerRepository.getActiveTimer(this)
        val slotActivity = slotConfig.activity?.trim()?.ifEmpty { null }

        if (slotActivity == null) {
            tile.state = Tile.STATE_INACTIVE
            tile.label = "Tuile #$slotNumber"
            tile.icon = Icon.createWithResource(this, R.drawable.ic_qs_timer)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                tile.subtitle = "Configurer dans l’app"
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                tile.stateDescription = "Non configurée"
                tile.contentDescription = "Configurer la tuile TimeTracker numéro $slotNumber"
            }
            tile.updateTile()
            return
        }

        val isRunningHere = QuickTimerLogic.isSameTimerTarget(
            activeTimer,
            slotActivity,
            slotConfig.categoryId,
        )

        tile.state = if (isRunningHere) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
        tile.label = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            slotActivity
        } else {
            "TT — $slotActivity"
        }
        tile.icon = Icon.createWithResource(
            this,
            if (isRunningHere) R.drawable.ic_qs_timer_active else R.drawable.ic_qs_timer,
        )

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            tile.subtitle = if (isRunningHere && activeTimer != null) {
                val mins = QuickTimerLogic.computeElapsedMinutes(activeTimer.startTs, System.currentTimeMillis())
                "En cours · ${formatCompactDuration(mins)}"
            } else {
                slotConfig.categoryLabel?.trim()?.ifEmpty { null } ?: "TimeTracker"
            }
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            tile.stateDescription = if (isRunningHere) "Chronomètre actif" else "Prêt"
            tile.contentDescription = if (isRunningHere) {
                "Arrêter le chronomètre $slotActivity"
            } else {
                "Démarrer le chronomètre $slotActivity"
            }
        }

        tile.updateTile()
    }

    private fun launchMainActivityForConfig(slot: Int) {
        QuickTimerRepository.setPendingLaunchAction(this, QuickTimerStoreLogic.LAUNCH_ACTION_OPEN_CONFIG)
        val intent = Intent(this, MainActivity::class.java).apply {
            action = ACTION_OPEN_QUICK_TILES_CONFIG
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_SINGLE_TOP or
                Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(EXTRA_OPEN_QUICK_TILES_CONFIG, true)
            putExtra(EXTRA_QUICK_TILE_SLOT, slot)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            val pendingIntent = PendingIntent.getActivity(this, 1000 + slot, intent, flags)
            startActivityAndCollapse(pendingIntent)
        } else {
            @Suppress("DEPRECATION")
            startActivityAndCollapse(intent)
        }
    }

    private fun formatCompactDuration(mins: Int): String {
        val h = mins / 60
        val m = mins % 60
        return if (h > 0) "${h}h${m.toString().padStart(2, '0')}" else "${m} min"
    }

    companion object {
        const val ACTION_OPEN_QUICK_TILES_CONFIG = "com.timetracker.carnetdutemps.OPEN_QUICK_TILES_CONFIG"
        const val EXTRA_OPEN_QUICK_TILES_CONFIG = "openQuickTilesConfig"
        const val EXTRA_QUICK_TILE_SLOT = "quickTileSlot"
    }
}
