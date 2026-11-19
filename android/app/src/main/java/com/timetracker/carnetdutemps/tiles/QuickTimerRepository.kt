package com.timetracker.carnetdutemps.tiles

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject

/**
 * Thread-safe native persistence for Quick Settings timer tiles using synchronous
 * SharedPreferences commits so active timers, configuration, and completed entries
 * survive process death and work without opening the WebView.
 */
object QuickTimerRepository {
    private const val PREFS_NAME = "timetracker_quick_tiles_prefs"
    private const val KEY_CONFIG = "quick_tiles_config_json"
    private const val KEY_AVAILABLE_ACTIVITIES = "available_activities_json"
    private const val KEY_ACTIVE_TIMER = "active_timer_json"
    private const val KEY_ACTIVE_TIMER_UPDATED_AT = "active_timer_updated_at"
    private const val KEY_PENDING_ENTRIES = "pending_entries_json"
    private const val KEY_LAST_MUTATION_TS = "last_mutation_ts"
    private const val KEY_PENDING_LAUNCH_ACTION = "pending_launch_action"

    private val lock = Any()

    private fun prefs(context: Context): SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun getConfig(context: Context): QuickTilesConfig = synchronized(lock) {
        val raw = prefs(context).getString(KEY_CONFIG, null) ?: return QuickTilesConfig()
        return try {
            QuickTilesConfig.fromJson(JSONObject(raw))
        } catch (_: Exception) {
            QuickTilesConfig()
        }
    }

    fun saveConfig(context: Context, config: QuickTilesConfig) = synchronized(lock) {
        prefs(context).edit()
            .putString(KEY_CONFIG, config.toJson().toString())
            .commit()
    }

    fun getAvailableActivities(context: Context): List<AvailableTileActivity> = synchronized(lock) {
        QuickTimerStoreLogic.parseAvailableActivities(prefs(context).getString(KEY_AVAILABLE_ACTIVITIES, null))
    }

    fun saveAvailableActivities(context: Context, activities: List<AvailableTileActivity>) = synchronized(lock) {
        prefs(context).edit()
            .putString(KEY_AVAILABLE_ACTIVITIES, QuickTimerStoreLogic.serializeAvailableActivities(activities))
            .commit()
    }

    fun getActiveTimer(context: Context): NativeActiveTimer? = synchronized(lock) {
        readActiveTimerLocked(prefs(context))
    }

    fun getActiveTimerUpdatedAt(context: Context): Long = synchronized(lock) {
        prefs(context).getLong(KEY_ACTIVE_TIMER_UPDATED_AT, 0L)
    }

    fun syncActiveTimerFromWeb(
        context: Context,
        timer: NativeActiveTimer?,
        updatedAt: Long,
    ): Boolean = synchronized(lock) {
        val p = prefs(context)
        val currentUpdatedAt = p.getLong(KEY_ACTIVE_TIMER_UPDATED_AT, 0L)
        if (!QuickTimerStoreLogic.shouldAcceptWebTimerSync(updatedAt, currentUpdatedAt)) {
            return false
        }
        val currentTimer = readActiveTimerLocked(p)
        if (updatedAt == currentUpdatedAt && currentTimer == timer) {
            return false
        }
        val editor = p.edit()
        if (timer != null) {
            editor.putString(KEY_ACTIVE_TIMER, timer.toJson().toString())
        } else {
            editor.remove(KEY_ACTIVE_TIMER)
        }
        editor.putLong(KEY_ACTIVE_TIMER_UPDATED_AT, updatedAt)
        editor.putLong(KEY_LAST_MUTATION_TS, maxOf(p.getLong(KEY_LAST_MUTATION_TS, 0L), updatedAt))
        editor.commit()
        return true
    }

    /**
     * Atomically toggles the activity mapped to `slotNumber`:
     * - Idle -> starts slot activity
     * - Same activity running -> stops it and appends pending entry
     * - Other activity running -> atomically closes previous entry & starts new timer at identical timestamp
     */
    fun toggleSlot(
        context: Context,
        slotNumber: Int,
        nowMs: Long = System.currentTimeMillis(),
    ): TileTapResult? = synchronized(lock) {
        val config = getConfig(context)
        val slotConfig = config.slotFor(slotNumber)
        val activity = slotConfig.activity?.trim()?.ifEmpty { null } ?: return null

        return activateActivityLocked(
            context = context,
            activity = activity,
            categoryId = slotConfig.categoryId,
            categoryLabel = slotConfig.categoryLabel,
            nowMs = nowMs,
        )
    }

    /**
     * Atomically starts or toggles a specific activity (used by Picker dialog & slots).
     */
    fun activateActivity(
        context: Context,
        activity: String,
        categoryId: String?,
        categoryLabel: String?,
        nowMs: Long = System.currentTimeMillis(),
    ): TileTapResult = synchronized(lock) {
        activateActivityLocked(context, activity, categoryId, categoryLabel, nowMs)
    }

    fun stopActiveTimer(
        context: Context,
        nowMs: Long = System.currentTimeMillis(),
    ): TileTapResult? = synchronized(lock) {
        val p = prefs(context)
        val current = readActiveTimerLocked(p) ?: return null
        val prevUpdatedAt = p.getLong(KEY_ACTIVE_TIMER_UPDATED_AT, 0L)
        val effectiveNow = QuickTimerStoreLogic.monotonicTimestamp(nowMs, prevUpdatedAt)
        val result = QuickTimerLogic.computeStopTransition(current, effectiveNow) ?: return null
        commitTransitionLocked(p, result)
        return result
    }

    private fun activateActivityLocked(
        context: Context,
        activity: String,
        categoryId: String?,
        categoryLabel: String?,
        nowMs: Long,
    ): TileTapResult {
        val p = prefs(context)
        val currentTimer = readActiveTimerLocked(p)
        val prevUpdatedAt = p.getLong(KEY_ACTIVE_TIMER_UPDATED_AT, 0L)
        val effectiveNow = QuickTimerStoreLogic.monotonicTimestamp(nowMs, prevUpdatedAt)

        val result = QuickTimerLogic.computeTileTapTransition(
            currentTimer = currentTimer,
            targetActivity = activity,
            targetCategoryId = categoryId,
            targetCategoryLabel = categoryLabel,
            nowMs = effectiveNow,
        )
        commitTransitionLocked(p, result)
        return result
    }

    private fun commitTransitionLocked(p: SharedPreferences, result: TileTapResult) {
        val existingPending = readPendingEntriesLocked(p)
        val updatedPending = QuickTimerStoreLogic.appendPendingEntryIdempotent(existingPending, result.producedEntry)

        val editor = p.edit()
        if (result.activeTimer != null) {
            editor.putString(KEY_ACTIVE_TIMER, result.activeTimer.toJson().toString())
        } else {
            editor.remove(KEY_ACTIVE_TIMER)
        }
        editor.putLong(KEY_ACTIVE_TIMER_UPDATED_AT, result.transitionTs)
        editor.putLong(KEY_LAST_MUTATION_TS, result.transitionTs)
        editor.putString(KEY_PENDING_ENTRIES, QuickTimerStoreLogic.serializePendingEntries(updatedPending))
        editor.commit()
    }

    fun getPendingSyncSnapshot(
        context: Context,
        consumeLaunchAction: Boolean = true,
    ): PendingSyncSnapshot = synchronized(lock) {
        val p = prefs(context)
        val activeTimer = readActiveTimerLocked(p)
        val updatedAt = p.getLong(KEY_ACTIVE_TIMER_UPDATED_AT, 0L)
        val lastMutation = p.getLong(KEY_LAST_MUTATION_TS, 0L)
        val pending = readPendingEntriesLocked(p)
        val launchAction = p.getString(KEY_PENDING_LAUNCH_ACTION, null)
        if (consumeLaunchAction && launchAction != null) {
            p.edit().remove(KEY_PENDING_LAUNCH_ACTION).commit()
        }
        return PendingSyncSnapshot(
            activeTimer = activeTimer,
            activeTimerUpdatedAt = updatedAt,
            pendingEntries = pending,
            lastMutationTs = lastMutation,
            pendingLaunchAction = launchAction,
        )
    }

    fun acknowledgePendingEntries(context: Context, entryIds: List<String>): Int = synchronized(lock) {
        if (entryIds.isEmpty()) return 0
        val p = prefs(context)
        val existing = readPendingEntriesLocked(p)
        val (remaining, removed) = QuickTimerStoreLogic.acknowledgeEntries(existing, entryIds)
        if (removed <= 0) return 0

        p.edit().putString(KEY_PENDING_ENTRIES, QuickTimerStoreLogic.serializePendingEntries(remaining)).commit()
        return removed
    }

    fun setPendingLaunchAction(context: Context, action: String?) = synchronized(lock) {
        val editor = prefs(context).edit()
        if (action.isNullOrBlank()) {
            editor.remove(KEY_PENDING_LAUNCH_ACTION)
        } else {
            editor.putString(KEY_PENDING_LAUNCH_ACTION, action)
        }
        editor.commit()
    }

    private fun readActiveTimerLocked(p: SharedPreferences): NativeActiveTimer? {
        val raw = p.getString(KEY_ACTIVE_TIMER, null) ?: return null
        return try {
            NativeActiveTimer.fromJson(JSONObject(raw))
        } catch (_: Exception) {
            null
        }
    }

    private fun readPendingEntriesLocked(p: SharedPreferences): List<NativePendingEntry> =
        QuickTimerStoreLogic.parsePendingEntries(p.getString(KEY_PENDING_ENTRIES, null))
}
