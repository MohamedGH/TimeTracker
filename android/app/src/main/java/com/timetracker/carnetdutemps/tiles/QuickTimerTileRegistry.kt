package com.timetracker.carnetdutemps.tiles

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.service.quicksettings.TileService
import java.lang.ref.WeakReference
import java.util.Collections

/**
 * Registry mapping fixed statically-declared AndroidManifest TileService classes
 * to slot numbers 1..6, managing dynamic enable/disable states, in-process live
 * refreshes for already-bound Quick Settings tiles, and `requestListeningState` calls.
 */
object QuickTimerTileRegistry {
    interface RefreshableQuickTile {
        fun refreshFromRepository()
    }

    private val slotServiceClasses: Map<Int, Class<*>> = mapOf(
        1 to QuickTimerTile1Service::class.java,
        2 to QuickTimerTile2Service::class.java,
        3 to QuickTimerTile3Service::class.java,
        4 to QuickTimerTile4Service::class.java,
        5 to QuickTimerTile5Service::class.java,
        6 to QuickTimerTile6Service::class.java,
    )

    private val listeningTiles: MutableSet<WeakReference<RefreshableQuickTile>> =
        Collections.synchronizedSet(mutableSetOf())

    fun registerListeningTile(tile: RefreshableQuickTile) {
        synchronized(listeningTiles) {
            listeningTiles.removeAll { it.get() == null || it.get() === tile }
            listeningTiles.add(WeakReference(tile))
        }
    }

    fun unregisterListeningTile(tile: RefreshableQuickTile) {
        synchronized(listeningTiles) {
            listeningTiles.removeAll { it.get() == null || it.get() === tile }
        }
    }

    fun componentForSlot(context: Context, slotNumber: Int): ComponentName? {
        val cls = slotServiceClasses[slotNumber] ?: return null
        return ComponentName(context.packageName, cls.name)
    }

    fun pickerComponent(context: Context): ComponentName =
        ComponentName(context.packageName, QuickTimerPickerTileService::class.java.name)

    fun ensureSlotEnabled(context: Context, slotNumber: Int) {
        val component = componentForSlot(context, slotNumber) ?: return
        val pm = context.packageManager
        try {
            val current = pm.getComponentEnabledSetting(component)
            val defaultEnabled = slotNumber <= DEFAULT_ENABLED_QUICK_TILE_SLOTS
            val alreadyEnabled = current == PackageManager.COMPONENT_ENABLED_STATE_ENABLED ||
                (current == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT && defaultEnabled)
            if (!alreadyEnabled) {
                pm.setComponentEnabledSetting(
                    component,
                    PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                    PackageManager.DONT_KILL_APP,
                )
            }
        } catch (_: Exception) {
            // Ignore if OEM package manager rejects component state update
        }
    }

    fun applyComponentEnabledStates(context: Context, config: QuickTilesConfig) {
        val pm = context.packageManager
        for (slot in 1..MAX_QUICK_TILE_SLOTS) {
            val component = componentForSlot(context, slot) ?: continue
            val slotConfig = config.slotFor(slot)
            val defaultEnabled = slot <= DEFAULT_ENABLED_QUICK_TILE_SLOTS
            val desiredState = if (slotConfig.enabled) {
                PackageManager.COMPONENT_ENABLED_STATE_ENABLED
            } else {
                PackageManager.COMPONENT_ENABLED_STATE_DISABLED
            }
            try {
                val current = pm.getComponentEnabledSetting(component)
                if (current == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT && slotConfig.enabled == defaultEnabled) {
                    continue
                }
                if (current != desiredState) {
                    pm.setComponentEnabledSetting(component, desiredState, PackageManager.DONT_KILL_APP)
                }
            } catch (_: Exception) {
                // Ignore if OEM package manager rejects component state query
            }
        }
    }

    /**
     * Immediately refreshes all currently listening in-process Quick Settings tiles
     * AND asks SystemUI to bind/refresh any unbound tiles via `requestListeningState`.
     */
    fun refreshAllTiles(context: Context) {
        val activeListeners: List<RefreshableQuickTile> = synchronized(listeningTiles) {
            val iterator = listeningTiles.iterator()
            val live = mutableListOf<RefreshableQuickTile>()
            while (iterator.hasNext()) {
                val item = iterator.next().get()
                if (item == null) {
                    iterator.remove()
                } else {
                    live.add(item)
                }
            }
            live
        }

        for (tileService in activeListeners) {
            try {
                tileService.refreshFromRepository()
            } catch (_: Exception) {
            }
        }

        requestAllListening(context)
    }

    fun requestAllListening(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return
        val config = QuickTimerRepository.getConfig(context)
        for (slot in 1..MAX_QUICK_TILE_SLOTS) {
            if (!config.slotFor(slot).enabled) continue
            val component = componentForSlot(context, slot) ?: continue
            try {
                TileService.requestListeningState(context, component)
            } catch (_: Exception) {
                // SystemUI may reject when user is not in foreground user or service unbound
            }
        }
        try {
            TileService.requestListeningState(context, pickerComponent(context))
        } catch (_: Exception) {
        }
    }
}
