package com.timetracker.carnetdutemps.tiles

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.TimeZone

class QuickTimerLogicTest {
    private val utc: TimeZone = TimeZone.getTimeZone("UTC")

    @Test
    fun startFromIdleCreatesActiveTimerWithZeroEntry() {
        val t0 = 1763460000000L // 2025-11-18T10:00:00Z
        val res = QuickTimerLogic.computeTileTapTransition(
            currentTimer = null,
            targetActivity = "Travail",
            targetCategoryId = "travail",
            targetCategoryLabel = "Travail",
            nowMs = t0,
            entryId = "e-1",
            timeZone = utc,
        )

        assertEquals("started", res.action)
        assertNull(res.producedEntry)
        assertNotNull(res.activeTimer)
        assertEquals("Travail", res.activeTimer?.activity)
        assertEquals("travail", res.activeTimer?.categoryId)
        assertEquals(t0, res.activeTimer?.startTs)
        assertEquals("10:00", res.activeTimer?.startTime)
        assertEquals("2025-11-18", res.activeTimer?.date)
    }

    @Test
    fun tapSameTileStopsTimerAndProducesViaTimerEntry() {
        val t0 = 1763460000000L // 10:00:00Z
        val t1 = t0 + 45 * 60_000L // 10:45:00Z

        val started = QuickTimerLogic.computeTileTapTransition(
            currentTimer = null,
            targetActivity = "Étude",
            targetCategoryId = "etude",
            targetCategoryLabel = "Étude",
            nowMs = t0,
            timeZone = utc,
        ).activeTimer!!

        val stopped = QuickTimerLogic.computeTileTapTransition(
            currentTimer = started,
            targetActivity = "Étude",
            targetCategoryId = "etude",
            targetCategoryLabel = "Étude",
            nowMs = t1,
            entryId = "entry-etude-1",
            timeZone = utc,
        )

        assertEquals("stopped", stopped.action)
        assertNull(stopped.activeTimer)
        assertNotNull(stopped.producedEntry)
        assertEquals("entry-etude-1", stopped.producedEntry?.id)
        assertEquals("Étude", stopped.producedEntry?.activity)
        assertEquals("etude", stopped.producedEntry?.categoryId)
        assertEquals("10:00", stopped.producedEntry?.start)
        assertEquals("10:45", stopped.producedEntry?.end)
        assertEquals(45, stopped.producedEntry?.mins)
        assertTrue(stopped.producedEntry?.viaTimer == true)
    }

    @Test
    fun switchingTileAtomicallyClosesPreviousAndStartsNextAtSameTimestamp() {
        val t0 = 1763460000000L // 10:00:00Z
        val tSwitch = t0 + 30 * 60_000L // 10:30:00Z

        val activeWork = QuickTimerLogic.computeTileTapTransition(
            currentTimer = null,
            targetActivity = "Travail",
            targetCategoryId = "travail",
            targetCategoryLabel = "Travail",
            nowMs = t0,
            timeZone = utc,
        ).activeTimer!!

        val switched = QuickTimerLogic.computeTileTapTransition(
            currentTimer = activeWork,
            targetActivity = "Sport",
            targetCategoryId = "sport",
            targetCategoryLabel = "Sport",
            nowMs = tSwitch,
            entryId = "entry-work-closed",
            timeZone = utc,
        )

        assertEquals("switched", switched.action)
        assertNotNull(switched.producedEntry)
        assertNotNull(switched.activeTimer)

        assertEquals("Travail", switched.producedEntry?.activity)
        assertEquals("10:00", switched.producedEntry?.start)
        assertEquals("10:30", switched.producedEntry?.end)
        assertEquals(30, switched.producedEntry?.mins)
        assertEquals(tSwitch, switched.producedEntry?.endTs)

        assertEquals("Sport", switched.activeTimer?.activity)
        assertEquals("sport", switched.activeTimer?.categoryId)
        assertEquals("10:30", switched.activeTimer?.startTime)
        assertEquals(tSwitch, switched.activeTimer?.startTs)
    }

    @Test
    fun crossMidnightTimerPreservesStartDateEndDateAndElapsedMinutes() {
        val tStart = 1763509800000L // 2025-11-18T23:50:00Z
        val tEnd = tStart + 35 * 60_000L // 2025-11-19T00:25:00Z

        val active = QuickTimerLogic.computeTileTapTransition(
            currentTimer = null,
            targetActivity = "Sommeil",
            targetCategoryId = "sommeil",
            targetCategoryLabel = "Sommeil",
            nowMs = tStart,
            timeZone = utc,
        ).activeTimer!!

        val stopped = QuickTimerLogic.computeTileTapTransition(
            currentTimer = active,
            targetActivity = "Sommeil",
            targetCategoryId = "sommeil",
            targetCategoryLabel = "Sommeil",
            nowMs = tEnd,
            entryId = "entry-midnight",
            timeZone = utc,
        )

        assertEquals("2025-11-18", stopped.producedEntry?.date)
        assertEquals("23:50", stopped.producedEntry?.start)
        assertEquals("2025-11-19", stopped.producedEntry?.endDate)
        assertEquals("00:25", stopped.producedEntry?.end)
        assertEquals(35, stopped.producedEntry?.mins)
    }

    @Test
    fun computeStopTransitionStopsAnyActiveTimerCleanly() {
        val t0 = 1763460000000L
        val t1 = t0 + 12 * 60_000L
        val active = QuickTimerLogic.computeTileTapTransition(
            currentTimer = null,
            targetActivity = "Lecture",
            targetCategoryId = "loisirs",
            targetCategoryLabel = "Loisirs",
            nowMs = t0,
            timeZone = utc,
        ).activeTimer!!

        assertNull(QuickTimerLogic.computeStopTransition(null, t1, timeZone = utc))
        val stopped = QuickTimerLogic.computeStopTransition(active, t1, entryId = "stop-1", timeZone = utc)
        assertNotNull(stopped)
        assertEquals("stopped", stopped?.action)
        assertNull(stopped?.activeTimer)
        assertEquals(12, stopped?.producedEntry?.mins)
        assertEquals("stop-1", stopped?.producedEntry?.id)
    }

    @Test
    fun configJsonRoundTripPreservesSixSlotsAndDefaults() {
        val raw = JSONObject(
            """
            {
              "allowOnLockScreen": false,
              "slots": [
                {"slot": 1, "enabled": true, "activity": "Travail", "categoryId": "travail", "categoryLabel": "Travail"},
                {"slot": 5, "enabled": true, "activity": "Lecture", "categoryId": "loisirs", "categoryLabel": "Loisirs"}
              ]
            }
            """.trimIndent(),
        )
        val parsed = QuickTilesConfig.fromJson(raw)
        assertFalse(parsed.allowOnLockScreen)
        assertEquals(6, parsed.slots.size)
        assertEquals("Travail", parsed.slotFor(1).activity)
        assertTrue(parsed.slotFor(4).enabled)
        assertTrue(parsed.slotFor(5).enabled)
        assertEquals("Lecture", parsed.slotFor(5).activity)
        assertFalse(parsed.slotFor(6).enabled)

        val roundTrip = QuickTilesConfig.fromJson(parsed.toJson())
        assertEquals(parsed, roundTrip)
    }

    @Test
    fun pendingEntriesStoreLogicIsIdempotentAndMonotonic() {
        val e1 = NativePendingEntry("id-1", "Travail", "travail", "2026-11-18", "09:00", "09:30", "2026-11-18", 30, true, 1000L, 2000L)
        val e2 = NativePendingEntry("id-2", "Sport", "sport", "2026-11-18", "09:30", "10:00", "2026-11-18", 30, true, 2000L, 3000L)

        val afterFirst = QuickTimerStoreLogic.appendPendingEntryIdempotent(emptyList(), e1)
        val afterDup = QuickTimerStoreLogic.appendPendingEntryIdempotent(afterFirst, e1)
        val afterSecond = QuickTimerStoreLogic.appendPendingEntryIdempotent(afterDup, e2)
        assertEquals(2, afterSecond.size)

        val serialized = QuickTimerStoreLogic.serializePendingEntries(afterSecond)
        val parsed = QuickTimerStoreLogic.parsePendingEntries(serialized)
        assertEquals(afterSecond, parsed)

        val (remaining, removed) = QuickTimerStoreLogic.acknowledgeEntries(parsed, listOf("id-1", "unknown"))
        assertEquals(1, removed)
        assertEquals(listOf(e2), remaining)

        assertFalse(QuickTimerStoreLogic.shouldAcceptWebTimerSync(1500L, 2000L))
        assertTrue(QuickTimerStoreLogic.shouldAcceptWebTimerSync(2000L, 2000L))
        assertTrue(QuickTimerStoreLogic.shouldAcceptWebTimerSync(2500L, 2000L))
        assertEquals(2001L, QuickTimerStoreLogic.monotonicTimestamp(1900L, 2000L))
        assertEquals(2500L, QuickTimerStoreLogic.monotonicTimestamp(2500L, 2000L))
    }

    @Test
    fun pendingSyncSnapshotMatchesJsBridgeContract() {
        val timer = NativeActiveTimer("Étude", "etude", "Étude", 5000L, "11:00", "2026-11-18")
        val snap = PendingSyncSnapshot(
            activeTimer = timer,
            activeTimerUpdatedAt = 5000L,
            pendingEntries = emptyList(),
            lastMutationTs = 5000L,
            pendingLaunchAction = QuickTimerStoreLogic.LAUNCH_ACTION_OPEN_CONFIG,
        )
        val json = snap.toJsonObject()
        assertEquals(5000L, json.getLong("activeTimerUpdatedAt"))
        assertEquals("open_quick_tiles_config", json.getString("pendingLaunchAction"))
        assertEquals("Étude", json.getJSONObject("activeTimer").getString("activity"))
    }

    @Test
    fun lockScreenNotificationSpecReflectsActiveTimerAndLockPolicy() {
        val allowLockedConfig = QuickTilesConfig(allowOnLockScreen = true)
        val requireUnlockConfig = QuickTilesConfig(allowOnLockScreen = false)

        assertNull(QuickTimerLogic.buildNotificationSpec(null, allowLockedConfig))

        val timer = NativeActiveTimer("Travail", "travail", "Travail", 9000L, "09:15", "2026-11-20")
        val specAllow = QuickTimerLogic.buildNotificationSpec(timer, allowLockedConfig)!!
        assertEquals("Travail", specAllow.title)
        assertEquals("Travail · Démarré à 09:15", specAllow.contentText)
        assertEquals("Chrono en cours", specAllow.subText)
        assertEquals(9000L, specAllow.startTs)
        assertFalse(specAllow.requireUnlockForStopAction)

        val specLocked = QuickTimerLogic.buildNotificationSpec(timer.copy(categoryLabel = null), requireUnlockConfig)!!
        assertEquals("Démarré à 09:15", specLocked.contentText)
        assertTrue(specLocked.requireUnlockForStopAction)
    }
}
