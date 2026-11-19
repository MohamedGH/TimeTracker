package com.timetracker.carnetdutemps.tiles

import android.os.Build
import androidx.annotation.RequiresApi

/**
 * Fixed statically-declared TileService slots (1..6) required by Android's
 * Quick Settings manifest registration model. Each slot maps dynamically
 * to any real user-selected TimeTracker activity.
 */
@RequiresApi(Build.VERSION_CODES.N)
class QuickTimerTile1Service : BaseQuickTimerTileService(1)

@RequiresApi(Build.VERSION_CODES.N)
class QuickTimerTile2Service : BaseQuickTimerTileService(2)

@RequiresApi(Build.VERSION_CODES.N)
class QuickTimerTile3Service : BaseQuickTimerTileService(3)

@RequiresApi(Build.VERSION_CODES.N)
class QuickTimerTile4Service : BaseQuickTimerTileService(4)

@RequiresApi(Build.VERSION_CODES.N)
class QuickTimerTile5Service : BaseQuickTimerTileService(5)

@RequiresApi(Build.VERSION_CODES.N)
class QuickTimerTile6Service : BaseQuickTimerTileService(6)
