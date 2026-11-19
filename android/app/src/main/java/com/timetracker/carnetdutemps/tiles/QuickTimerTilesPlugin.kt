package com.timetracker.carnetdutemps.tiles

import android.app.KeyguardManager
import android.app.StatusBarManager
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.os.Build
import androidx.core.content.ContextCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.timetracker.carnetdutemps.R
import java.lang.ref.WeakReference

@CapacitorPlugin(name = "QuickTimerTiles")
class QuickTimerTilesPlugin : Plugin() {

    override fun load() {
        super.load()
        activeInstance = WeakReference(this)
        handleIntentIfNeeded(activity?.intent)
    }

    override fun handleOnNewIntent(intent: Intent?) {
        super.handleOnNewIntent(intent)
        handleIntentIfNeeded(intent)
    }

    override fun handleOnDestroy() {
        if (activeInstance?.get() === this) {
            activeInstance = null
        }
        super.handleOnDestroy()
    }

    private fun handleIntentIfNeeded(intent: Intent?) {
        if (intent == null) return
        val shouldOpenConfig = intent.getBooleanExtra(BaseQuickTimerTileService.EXTRA_OPEN_QUICK_TILES_CONFIG, false) ||
            intent.action == BaseQuickTimerTileService.ACTION_OPEN_QUICK_TILES_CONFIG
        if (!shouldOpenConfig) return

        val slot = intent.getIntExtra(BaseQuickTimerTileService.EXTRA_QUICK_TILE_SLOT, 0)
        val payload = JSObject().apply {
            put("slot", slot)
        }
        notifyListeners("openQuickTilesConfig", payload, true)
    }

    @PluginMethod
    fun getCapabilities(call: PluginCall) {
        val ctx = context
        val km = ctx.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
        val config = QuickTimerRepository.getConfig(ctx)
        val result = JSObject().apply {
            put("supported", Build.VERSION.SDK_INT >= Build.VERSION_CODES.N)
            put("platform", "android")
            put("isNative", true)
            put("apiLevel", Build.VERSION.SDK_INT)
            put("androidRelease", Build.VERSION.RELEASE ?: "")
            put("maxSlots", MAX_QUICK_TILE_SLOTS)
            put("supportsRequestAddTileService", Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
            put("isDeviceLocked", km?.isDeviceLocked == true)
            put("isKeyguardSecure", km?.isKeyguardSecure == true)
            put("allowOnLockScreen", config.allowOnLockScreen)
            put("pickerRequiresUnlockOnLockedScreen", true)
        }
        call.resolve(result)
    }

    @PluginMethod
    fun syncConfiguration(call: PluginCall) {
        val ctx = context
        val configObj = call.getObject("config")
        val config = QuickTilesConfig.fromJson(configObj)
        QuickTimerRepository.saveConfig(ctx, config)

        val activitiesArr = call.getArray("availableActivities")
        if (activitiesArr != null) {
            val available = mutableListOf<AvailableTileActivity>()
            for (i in 0 until activitiesArr.length()) {
                AvailableTileActivity.fromJson(activitiesArr.optJSONObject(i))?.let { available.add(it) }
            }
            QuickTimerRepository.saveAvailableActivities(ctx, available)
        }

        QuickTimerTileRegistry.applyComponentEnabledStates(ctx, config)
        QuickTimerTileRegistry.refreshAllTiles(ctx)

        call.resolve(JSObject().apply {
            put("synced", true)
            put("nativeApplied", true)
        })
    }

    @PluginMethod
    fun syncActiveTimer(call: PluginCall) {
        val ctx = context
        val timerObj = call.getObject("activeTimer")
        val updatedAt = call.data.optLong("updatedAt", System.currentTimeMillis())
        val timer = NativeActiveTimer.fromJson(timerObj)

        val applied = QuickTimerRepository.syncActiveTimerFromWeb(ctx, timer, updatedAt)
        if (applied) {
            QuickTimerTileRegistry.refreshAllTiles(ctx)
        }

        call.resolve(JSObject().apply {
            put("synced", true)
            put("nativeApplied", applied)
        })
    }

    @PluginMethod
    fun getPendingSyncSnapshot(call: PluginCall) {
        call.resolve(buildSnapshotJson(context, consumeLaunchAction = true))
    }

    @PluginMethod
    fun acknowledgePendingEntries(call: PluginCall) {
        val idsArr = call.getArray("entryIds")
        val ids = mutableListOf<String>()
        if (idsArr != null) {
            for (i in 0 until idsArr.length()) {
                val id = idsArr.optString(i, "").trim()
                if (id.isNotEmpty()) ids.add(id)
            }
        }
        val removed = QuickTimerRepository.acknowledgePendingEntries(context, ids)
        call.resolve(JSObject().apply {
            put("acknowledgedCount", removed)
        })
    }

    @PluginMethod
    fun requestAddTile(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            call.resolve(JSObject().apply {
                put("status", "manual_guide")
                put("message", "Ouvrez le panneau des Réglages rapides puis touchez le crayon (Modifier) pour glisser la tuile TimeTracker.")
            })
            return
        }

        val ctx = context
        val slot = call.getInt("slot") ?: 1
        val component = QuickTimerTileRegistry.componentForSlot(ctx, slot)
        if (component == null) {
            call.reject("Emplacement de tuile invalide.")
            return
        }

        QuickTimerTileRegistry.ensureSlotEnabled(ctx, slot)

        val config = QuickTimerRepository.getConfig(ctx)
        val slotConfig = config.slotFor(slot)
        val label = slotConfig.activity?.trim()?.ifEmpty { null }?.let { "TimeTracker — $it" }
            ?: "TimeTracker — Tuile $slot"

        val statusBarManager = ctx.getSystemService(StatusBarManager::class.java)
        if (statusBarManager == null) {
            call.resolve(JSObject().apply {
                put("status", "unavailable")
                put("message", "StatusBarManager indisponible sur cet appareil.")
            })
            return
        }

        try {
            val icon = Icon.createWithResource(ctx, R.drawable.ic_qs_timer)
            statusBarManager.requestAddTileService(
                component,
                label,
                icon,
                ContextCompat.getMainExecutor(ctx),
            ) { resultCode ->
                val (status, msg) = when (resultCode) {
                    StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ADDED ->
                        "added" to null
                    StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ALREADY_ADDED ->
                        "already_added" to null
                    StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_NOT_ADDED ->
                        "dismissed" to "Ajout annulé par l’utilisateur."
                    else ->
                        "error" to "Impossible d’ajouter la tuile automatiquement (code $resultCode). Ajoutez-la manuellement via Modifier dans les Réglages rapides."
                }
                call.resolve(JSObject().apply {
                    put("status", status)
                    put("resultCode", resultCode)
                    if (msg != null) put("message", msg)
                })
            }
        } catch (err: Exception) {
            call.resolve(JSObject().apply {
                put("status", "manual_guide")
                put("message", "Ajoutez cette tuile manuellement depuis Modifier dans les Réglages rapides (${err.message ?: "système"}).")
            })
        }
    }

    @PluginMethod
    fun refreshTiles(call: PluginCall) {
        QuickTimerTileRegistry.refreshAllTiles(context)
        call.resolve(JSObject().apply { put("refreshed", true) })
    }

    private fun emitTimerStateChanged() {
        notifyListeners("nativeTimerStateChanged", buildSnapshotJson(context, consumeLaunchAction = false), false)
    }

    companion object {
        @Volatile
        private var activeInstance: WeakReference<QuickTimerTilesPlugin>? = null

        fun notifyNativeTimerChanged(context: Context) {
            activeInstance?.get()?.emitTimerStateChanged()
        }

        fun buildSnapshotJson(context: Context, consumeLaunchAction: Boolean = true): JSObject {
            val snap = QuickTimerRepository.getPendingSyncSnapshot(context, consumeLaunchAction)
            val entriesArr = JSArray().apply {
                snap.pendingEntries.forEach { put(it.toJson()) }
            }
            return JSObject().apply {
                put("activeTimer", snap.activeTimer?.toJson() ?: JSObject.NULL)
                put("activeTimerUpdatedAt", snap.activeTimerUpdatedAt)
                put("pendingEntries", entriesArr)
                put("lastMutationTs", snap.lastMutationTs)
                put("pendingLaunchAction", snap.pendingLaunchAction ?: JSObject.NULL)
            }
        }
    }
}
