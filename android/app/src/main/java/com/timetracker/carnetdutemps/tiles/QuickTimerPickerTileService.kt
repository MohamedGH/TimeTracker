package com.timetracker.carnetdutemps.tiles

import android.app.AlertDialog
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
 * Secondary Quick Settings selector tile.
 * Displays an activity chooser AlertDialog via `showDialog()` when unlocked.
 * Because Android restricts or blocks Quick Settings dialogs on locked screens,
 * this tile delegates to `unlockAndRun()` when locked and serves only as a
 * complementary selector alongside the primary per-activity tiles (Slots 1..6).
 */
@RequiresApi(Build.VERSION_CODES.N)
class QuickTimerPickerTileService : TileService(), QuickTimerTileRegistry.RefreshableQuickTile {

    override fun onTileAdded() {
        super.onTileAdded()
        refreshTileState()
    }

    override fun onStartListening() {
        super.onStartListening()
        QuickTimerTileRegistry.registerListeningTile(this)
        refreshTileState()
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
        refreshTileState()
    }

    override fun onClick() {
        super.onClick()
        if (isLocked) {
            unlockAndRun { showActivityPickerDialog() }
        } else {
            showActivityPickerDialog()
        }
    }

    private fun showActivityPickerDialog() {
        val available = collectPickerOptions()
        val activeTimer = QuickTimerRepository.getActiveTimer(this)

        if (available.isEmpty() && activeTimer == null) {
            val dialog = AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle("TimeTracker")
                .setMessage("Aucune activité enregistrée. Ouvrez TimeTracker pour configurer vos activités favorites.")
                .setPositiveButton("Configurer") { _, _ -> launchAppConfig() }
                .setNegativeButton("Fermer", null)
                .create()
            showDialog(dialog)
            return
        }

        val labels = mutableListOf<String>()
        val actions = mutableListOf<() -> Unit>()

        if (activeTimer != null) {
            labels.add("⏹ Arrêter « ${activeTimer.activity} »")
            actions.add {
                QuickTimerRepository.stopActiveTimer(this)
                refreshTileState()
                QuickTimerTileRegistry.refreshAllTiles(this)
                QuickTimerTilesPlugin.notifyNativeTimerChanged(this)
            }
        }

        for (item in available) {
            val isRunning = QuickTimerLogic.isSameTimerTarget(activeTimer, item.activity, item.categoryId)
            val catSuffix = item.categoryLabel?.let { " ($it)" } ?: ""
            val prefix = if (isRunning) "● " else "▶ "
            labels.add("$prefix${item.activity}$catSuffix")
            actions.add {
                QuickTimerRepository.activateActivity(
                    context = this,
                    activity = item.activity,
                    categoryId = item.categoryId,
                    categoryLabel = item.categoryLabel,
                )
                refreshTileState()
                QuickTimerTileRegistry.refreshAllTiles(this)
                QuickTimerTilesPlugin.notifyNativeTimerChanged(this)
            }
        }

        val dialog = AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle("Choisir un chronomètre")
            .setItems(labels.toTypedArray()) { _, which ->
                actions.getOrNull(which)?.invoke()
            }
            .setNeutralButton("Configurer") { _, _ -> launchAppConfig() }
            .setNegativeButton("Annuler", null)
            .create()

        showDialog(dialog)
    }

    private fun collectPickerOptions(): List<AvailableTileActivity> {
        val seen = mutableSetOf<String>()
        val result = mutableListOf<AvailableTileActivity>()
        val config = QuickTimerRepository.getConfig(this)

        for (slot in config.slots) {
            val act = slot.activity?.trim()?.ifEmpty { null } ?: continue
            val key = QuickTimerLogic.normalizeActivityKey(act)
            if (seen.add(key)) {
                result.add(AvailableTileActivity("slot:${slot.slot}", act, slot.categoryId, slot.categoryLabel))
            }
        }

        for (item in QuickTimerRepository.getAvailableActivities(this)) {
            val key = QuickTimerLogic.normalizeActivityKey(item.activity)
            if (seen.add(key)) {
                result.add(item)
            }
        }

        return result
    }

    private fun refreshTileState() {
        val tile = qsTile ?: return
        val activeTimer = QuickTimerRepository.getActiveTimer(this)
        tile.icon = Icon.createWithResource(
            this,
            if (activeTimer != null) R.drawable.ic_qs_timer_active else R.drawable.ic_qs_picker,
        )
        if (activeTimer != null) {
            tile.state = Tile.STATE_ACTIVE
            tile.label = activeTimer.activity
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                tile.subtitle = "Changer / Arrêter"
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                tile.stateDescription = "Chronomètre actif"
                tile.contentDescription = "Changer ou arrêter le chronomètre ${activeTimer.activity}"
            }
        } else {
            tile.state = Tile.STATE_INACTIVE
            tile.label = "TimeTracker"
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                tile.subtitle = "Choisir activité"
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                tile.stateDescription = "Prêt"
                tile.contentDescription = "Choisir une activité TimeTracker à chronométrer"
            }
        }
        tile.updateTile()
    }

    private fun launchAppConfig() {
        QuickTimerRepository.setPendingLaunchAction(this, QuickTimerStoreLogic.LAUNCH_ACTION_OPEN_CONFIG)
        val intent = Intent(this, MainActivity::class.java).apply {
            action = BaseQuickTimerTileService.ACTION_OPEN_QUICK_TILES_CONFIG
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_SINGLE_TOP or
                Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(BaseQuickTimerTileService.EXTRA_OPEN_QUICK_TILES_CONFIG, true)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            startActivityAndCollapse(PendingIntent.getActivity(this, 1099, intent, flags))
        } else {
            @Suppress("DEPRECATION")
            startActivityAndCollapse(intent)
        }
    }
}
