package com.timetracker.carnetdutemps.tiles

import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import kotlin.math.floor
import kotlin.math.max

const val MAX_QUICK_TILE_SLOTS = 6
const val DEFAULT_ENABLED_QUICK_TILE_SLOTS = 4

data class QuickTileSlotConfig(
    val slot: Int,
    val enabled: Boolean,
    val activity: String?,
    val categoryId: String?,
    val categoryLabel: String?,
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("slot", slot)
        put("enabled", enabled)
        put("activity", activity ?: JSONObject.NULL)
        put("categoryId", categoryId ?: JSONObject.NULL)
        put("categoryLabel", categoryLabel ?: JSONObject.NULL)
    }

    companion object {
        fun fromJson(obj: JSONObject?, fallbackSlot: Int): QuickTileSlotConfig {
            val slotNum = (obj?.optInt("slot", fallbackSlot) ?: fallbackSlot).coerceIn(1, MAX_QUICK_TILE_SLOTS)
            val defaultEnabled = slotNum <= DEFAULT_ENABLED_QUICK_TILE_SLOTS
            if (obj == null) {
                return QuickTileSlotConfig(slotNum, defaultEnabled, null, null, null)
            }
            val rawAct = if (obj.isNull("activity")) null else obj.optString("activity", "").trim().ifEmpty { null }
            val rawCat = if (obj.isNull("categoryId")) null else obj.optString("categoryId", "").trim().ifEmpty { null }
            val rawCatLabel = if (obj.isNull("categoryLabel")) null else obj.optString("categoryLabel", "").trim().ifEmpty { null }
            val enabled = if (obj.has("enabled")) obj.optBoolean("enabled", defaultEnabled) else defaultEnabled
            return QuickTileSlotConfig(slotNum, enabled, rawAct, rawCat, rawCatLabel)
        }
    }
}

data class QuickTilesConfig(
    val allowOnLockScreen: Boolean = true,
    val slots: List<QuickTileSlotConfig> = defaultSlots(),
) {
    fun slotFor(slotNumber: Int): QuickTileSlotConfig =
        slots.firstOrNull { it.slot == slotNumber }
            ?: QuickTileSlotConfig(slotNumber, slotNumber <= DEFAULT_ENABLED_QUICK_TILE_SLOTS, null, null, null)

    fun toJson(): JSONObject = JSONObject().apply {
        put("allowOnLockScreen", allowOnLockScreen)
        put("slots", JSONArray().apply {
            slots.forEach { put(it.toJson()) }
        })
    }

    companion object {
        fun defaultSlots(): List<QuickTileSlotConfig> =
            (1..MAX_QUICK_TILE_SLOTS).map { slot ->
                QuickTileSlotConfig(
                    slot = slot,
                    enabled = slot <= DEFAULT_ENABLED_QUICK_TILE_SLOTS,
                    activity = null,
                    categoryId = null,
                    categoryLabel = null,
                )
            }

        fun fromJson(obj: JSONObject?): QuickTilesConfig {
            if (obj == null) return QuickTilesConfig()
            val allowOnLockScreen = obj.optBoolean("allowOnLockScreen", true)
            val arr = obj.optJSONArray("slots")
            val bySlot = mutableMapOf<Int, QuickTileSlotConfig>()
            if (arr != null) {
                for (i in 0 until arr.length()) {
                    val item = arr.optJSONObject(i) ?: continue
                    val parsed = QuickTileSlotConfig.fromJson(item, i + 1)
                    bySlot[parsed.slot] = parsed
                }
            }
            val normalizedSlots = (1..MAX_QUICK_TILE_SLOTS).map { slot ->
                bySlot[slot] ?: QuickTileSlotConfig(slot, slot <= DEFAULT_ENABLED_QUICK_TILE_SLOTS, null, null, null)
            }
            return QuickTilesConfig(allowOnLockScreen, normalizedSlots)
        }
    }
}

data class AvailableTileActivity(
    val id: String,
    val activity: String,
    val categoryId: String?,
    val categoryLabel: String?,
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("activity", activity)
        put("categoryId", categoryId ?: JSONObject.NULL)
        put("categoryLabel", categoryLabel ?: JSONObject.NULL)
    }

    companion object {
        fun fromJson(obj: JSONObject?): AvailableTileActivity? {
            if (obj == null) return null
            val activity = obj.optString("activity", "").trim()
            if (activity.isEmpty()) return null
            val id = obj.optString("id", "").trim().ifEmpty { "act:${activity.lowercase(Locale.ROOT)}" }
            val catId = if (obj.isNull("categoryId")) null else obj.optString("categoryId", "").trim().ifEmpty { null }
            val catLabel = if (obj.isNull("categoryLabel")) null else obj.optString("categoryLabel", "").trim().ifEmpty { null }
            return AvailableTileActivity(id, activity, catId, catLabel)
        }
    }
}

data class NativeActiveTimer(
    val activity: String,
    val categoryId: String?,
    val categoryLabel: String?,
    val startTs: Long,
    val startTime: String,
    val date: String,
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("activity", activity)
        put("categoryId", categoryId ?: JSONObject.NULL)
        put("cat", categoryId ?: JSONObject.NULL)
        put("categoryLabel", categoryLabel ?: JSONObject.NULL)
        put("startTs", startTs)
        put("startTime", startTime)
        put("date", date)
    }

    companion object {
        fun fromJson(obj: JSONObject?): NativeActiveTimer? {
            if (obj == null) return null
            val activity = obj.optString("activity", "").trim()
            val startTime = obj.optString("startTime", "").trim()
            val date = obj.optString("date", "").trim()
            val startTs = obj.optLong("startTs", -1L)
            if (activity.isEmpty() || startTime.isEmpty() || date.isEmpty() || startTs <= 0L) return null
            val catId = when {
                !obj.isNull("categoryId") -> obj.optString("categoryId", "").trim().ifEmpty { null }
                !obj.isNull("cat") -> obj.optString("cat", "").trim().ifEmpty { null }
                else -> null
            }
            val catLabel = if (obj.isNull("categoryLabel")) null else obj.optString("categoryLabel", "").trim().ifEmpty { null }
            return NativeActiveTimer(activity, catId, catLabel, startTs, startTime, date)
        }
    }
}

data class NativePendingEntry(
    val id: String,
    val activity: String,
    val categoryId: String?,
    val date: String,
    val start: String,
    val end: String,
    val endDate: String,
    val mins: Int,
    val viaTimer: Boolean,
    val startTs: Long,
    val endTs: Long,
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("activity", activity)
        put("categoryId", categoryId ?: JSONObject.NULL)
        put("date", date)
        put("start", start)
        put("end", end)
        put("endDate", endDate)
        put("mins", mins)
        put("viaTimer", viaTimer)
        put("startTs", startTs)
        put("endTs", endTs)
    }

    companion object {
        fun fromJson(obj: JSONObject?): NativePendingEntry? {
            if (obj == null) return null
            val id = obj.optString("id", "").trim()
            val activity = obj.optString("activity", "").trim()
            val date = obj.optString("date", "").trim()
            val start = obj.optString("start", "").trim()
            val end = obj.optString("end", "").trim()
            if (id.isEmpty() || activity.isEmpty() || date.isEmpty() || start.isEmpty() || end.isEmpty()) return null
            val catId = if (obj.isNull("categoryId")) null else obj.optString("categoryId", "").trim().ifEmpty { null }
            val endDate = obj.optString("endDate", "").trim().ifEmpty { date }
            val mins = max(0, obj.optInt("mins", 0))
            val viaTimer = obj.optBoolean("viaTimer", true)
            val startTs = obj.optLong("startTs", 0L)
            val endTs = obj.optLong("endTs", 0L)
            return NativePendingEntry(id, activity, catId, date, start, end, endDate, mins, viaTimer, startTs, endTs)
        }
    }
}

data class TileTapResult(
    val action: String, // "started" | "stopped" | "switched"
    val activeTimer: NativeActiveTimer?,
    val producedEntry: NativePendingEntry?,
    val transitionTs: Long,
)

data class PendingSyncSnapshot(
    val activeTimer: NativeActiveTimer?,
    val activeTimerUpdatedAt: Long,
    val pendingEntries: List<NativePendingEntry>,
    val lastMutationTs: Long,
    val pendingLaunchAction: String?,
) {
    fun toJsonObject(): JSONObject = JSONObject().apply {
        put("activeTimer", activeTimer?.toJson() ?: JSONObject.NULL)
        put("activeTimerUpdatedAt", activeTimerUpdatedAt)
        put("pendingEntries", JSONArray().apply {
            pendingEntries.forEach { put(it.toJson()) }
        })
        put("lastMutationTs", lastMutationTs)
        put("pendingLaunchAction", pendingLaunchAction ?: JSONObject.NULL)
    }
}

object QuickTimerStoreLogic {
    const val LAUNCH_ACTION_OPEN_CONFIG = "open_quick_tiles_config"

    fun parseAvailableActivities(rawJson: String?): List<AvailableTileActivity> {
        if (rawJson.isNullOrBlank()) return emptyList()
        return try {
            val arr = JSONArray(rawJson)
            val result = mutableListOf<AvailableTileActivity>()
            for (i in 0 until arr.length()) {
                AvailableTileActivity.fromJson(arr.optJSONObject(i))?.let { result.add(it) }
            }
            result
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun serializeAvailableActivities(activities: List<AvailableTileActivity>): String =
        JSONArray().apply {
            activities.forEach { put(it.toJson()) }
        }.toString()

    fun parsePendingEntries(rawJson: String?): List<NativePendingEntry> {
        if (rawJson.isNullOrBlank()) return emptyList()
        return try {
            val arr = JSONArray(rawJson)
            val result = mutableListOf<NativePendingEntry>()
            for (i in 0 until arr.length()) {
                NativePendingEntry.fromJson(arr.optJSONObject(i))?.let { result.add(it) }
            }
            result
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun serializePendingEntries(entries: List<NativePendingEntry>): String =
        JSONArray().apply {
            entries.forEach { put(it.toJson()) }
        }.toString()

    fun appendPendingEntryIdempotent(
        existing: List<NativePendingEntry>,
        produced: NativePendingEntry?,
    ): List<NativePendingEntry> {
        if (produced == null) return existing
        if (existing.any { it.id == produced.id }) return existing
        return existing + produced
    }

    fun acknowledgeEntries(
        existing: List<NativePendingEntry>,
        entryIds: List<String>,
    ): Pair<List<NativePendingEntry>, Int> {
        if (entryIds.isEmpty() || existing.isEmpty()) return existing to 0
        val ackSet = entryIds.map { it.trim() }.filter { it.isNotEmpty() }.toSet()
        if (ackSet.isEmpty()) return existing to 0
        val remaining = existing.filterNot { ackSet.contains(it.id) }
        return remaining to (existing.size - remaining.size)
    }

    fun shouldAcceptWebTimerSync(
        incomingUpdatedAt: Long,
        currentNativeUpdatedAt: Long,
    ): Boolean = incomingUpdatedAt >= currentNativeUpdatedAt

    fun monotonicTimestamp(requestedNowMs: Long, previousUpdatedAt: Long): Long =
        if (requestedNowMs <= previousUpdatedAt) previousUpdatedAt + 1L else requestedNowMs
}

object QuickTimerLogic {
    fun normalizeActivityKey(label: String?): String =
        (label ?: "").trim().lowercase(Locale.ROOT)

    fun isSameTimerTarget(timer: NativeActiveTimer?, activity: String, categoryId: String?): Boolean {
        if (timer == null) return false
        if (normalizeActivityKey(timer.activity) != normalizeActivityKey(activity)) return false
        if (timer.categoryId.isNullOrBlank() || categoryId.isNullOrBlank()) return true
        return timer.categoryId == categoryId
    }

    fun formatLocalDate(epochMs: Long, timeZone: TimeZone = TimeZone.getDefault()): String {
        val sdf = SimpleDateFormat("yyyy-MM-dd", Locale.US)
        sdf.timeZone = timeZone
        return sdf.format(Date(epochMs))
    }

    fun formatLocalClock(epochMs: Long, timeZone: TimeZone = TimeZone.getDefault()): String {
        val sdf = SimpleDateFormat("HH:mm", Locale.US)
        sdf.timeZone = timeZone
        return sdf.format(Date(epochMs))
    }

    fun computeElapsedMinutes(startTs: Long, endTs: Long): Int {
        if (endTs <= startTs) return 0
        return max(0, floor((endTs - startTs).toDouble() / 60000.0).toInt())
    }

    /**
     * Pure atomic tile transition matching JS `applyTileTapTransition` 1:1.
     */
    fun computeTileTapTransition(
        currentTimer: NativeActiveTimer?,
        targetActivity: String,
        targetCategoryId: String?,
        targetCategoryLabel: String?,
        nowMs: Long = System.currentTimeMillis(),
        entryId: String = UUID.randomUUID().toString(),
        timeZone: TimeZone = TimeZone.getDefault(),
    ): TileTapResult {
        val cleanActivity = targetActivity.trim()
        require(cleanActivity.isNotEmpty()) { "Target activity must not be blank" }

        val nowDate = formatLocalDate(nowMs, timeZone)
        val nowClock = formatLocalClock(nowMs, timeZone)
        val resolvedCatId = targetCategoryId?.trim()?.ifEmpty { null } ?: "autre"

        if (currentTimer == null) {
            val started = NativeActiveTimer(
                activity = cleanActivity,
                categoryId = resolvedCatId,
                categoryLabel = targetCategoryLabel?.trim()?.ifEmpty { null },
                startTs = nowMs,
                startTime = nowClock,
                date = nowDate,
            )
            return TileTapResult(
                action = "started",
                activeTimer = started,
                producedEntry = null,
                transitionTs = nowMs,
            )
        }

        val mins = computeElapsedMinutes(currentTimer.startTs, nowMs)
        val produced = NativePendingEntry(
            id = entryId,
            activity = currentTimer.activity,
            categoryId = currentTimer.categoryId,
            date = currentTimer.date,
            start = currentTimer.startTime,
            end = nowClock,
            endDate = nowDate,
            mins = mins,
            viaTimer = true,
            startTs = currentTimer.startTs,
            endTs = nowMs,
        )

        if (isSameTimerTarget(currentTimer, cleanActivity, resolvedCatId)) {
            return TileTapResult(
                action = "stopped",
                activeTimer = null,
                producedEntry = produced,
                transitionTs = nowMs,
            )
        }

        val switched = NativeActiveTimer(
            activity = cleanActivity,
            categoryId = resolvedCatId,
            categoryLabel = targetCategoryLabel?.trim()?.ifEmpty { null },
            startTs = nowMs,
            startTime = nowClock,
            date = nowDate,
        )
        return TileTapResult(
            action = "switched",
            activeTimer = switched,
            producedEntry = produced,
            transitionTs = nowMs,
        )
    }

    /**
     * Pure stop transition for an active timer (used by Picker dialog's "Arrêter" option).
     */
    fun computeStopTransition(
        currentTimer: NativeActiveTimer?,
        nowMs: Long = System.currentTimeMillis(),
        entryId: String = UUID.randomUUID().toString(),
        timeZone: TimeZone = TimeZone.getDefault(),
    ): TileTapResult? {
        if (currentTimer == null) return null
        val nowDate = formatLocalDate(nowMs, timeZone)
        val nowClock = formatLocalClock(nowMs, timeZone)
        val mins = computeElapsedMinutes(currentTimer.startTs, nowMs)
        val produced = NativePendingEntry(
            id = entryId,
            activity = currentTimer.activity,
            categoryId = currentTimer.categoryId,
            date = currentTimer.date,
            start = currentTimer.startTime,
            end = nowClock,
            endDate = nowDate,
            mins = mins,
            viaTimer = true,
            startTs = currentTimer.startTs,
            endTs = nowMs,
        )
        return TileTapResult(
            action = "stopped",
            activeTimer = null,
            producedEntry = produced,
            transitionTs = nowMs,
        )
    }

    /**
     * Pure specification for the lock-screen active chronometer notification.
     */
    fun buildNotificationSpec(
        activeTimer: NativeActiveTimer?,
        config: QuickTilesConfig,
    ): NativeChronoNotificationSpec? {
        if (activeTimer == null) return null
        val cleanCat = activeTimer.categoryLabel?.trim()?.ifEmpty { null }
        val contentText = if (cleanCat != null) {
            "$cleanCat · Démarré à ${activeTimer.startTime}"
        } else {
            "Démarré à ${activeTimer.startTime}"
        }
        return NativeChronoNotificationSpec(
            title = activeTimer.activity,
            contentText = contentText,
            subText = "Chrono en cours",
            startTs = activeTimer.startTs,
            requireUnlockForStopAction = !config.allowOnLockScreen,
        )
    }
}

data class NativeChronoNotificationSpec(
    val title: String,
    val contentText: String,
    val subText: String,
    val startTs: Long,
    val requireUnlockForStopAction: Boolean,
)

