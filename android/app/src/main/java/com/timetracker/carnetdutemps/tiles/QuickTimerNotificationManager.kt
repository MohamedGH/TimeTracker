package com.timetracker.carnetdutemps.tiles

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.timetracker.carnetdutemps.MainActivity
import com.timetracker.carnetdutemps.R

/**
 * Displays the active TimeTracker chronometer directly on the Android lock screen
 * using a VISIBILITY_PUBLIC ongoing notification with Android's native ticking Chronometer.
 * Cancels the notification automatically when no timer is active.
 */
object QuickTimerNotificationManager {
    const val CHANNEL_ID = "timetracker_active_chrono"
    const val NOTIFICATION_ID = 4201
    private const val OPEN_APP_REQUEST_CODE = 4202
    private const val STOP_ACTION_REQUEST_CODE = 4203

    fun hasNotificationPermission(context: Context): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS,
            ) == PackageManager.PERMISSION_GRANTED
            if (!granted) return false
        }
        return NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
        val existing = nm.getNotificationChannel(CHANNEL_ID)
        if (existing != null) return

        val channel = NotificationChannel(
            CHANNEL_ID,
            "Chronomètre actif",
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "Affiche le chronomètre en cours sur l’écran verrouillé et dans la barre de notifications."
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            setShowBadge(false)
            enableLights(false)
            enableVibration(false)
            setSound(null, null)
        }
        nm.createNotificationChannel(channel)
    }

    fun syncNotification(context: Context) {
        val appContext = context.applicationContext
        val nmCompat = NotificationManagerCompat.from(appContext)
        val activeTimer = QuickTimerRepository.getActiveTimer(appContext)
        val config = QuickTimerRepository.getConfig(appContext)
        val spec = QuickTimerLogic.buildNotificationSpec(activeTimer, config)

        if (spec == null) {
            try {
                nmCompat.cancel(NOTIFICATION_ID)
            } catch (_: Exception) {
            }
            return
        }

        if (!hasNotificationPermission(appContext)) {
            return
        }

        ensureChannel(appContext)

        val openAppIntent = Intent(appContext, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_SINGLE_TOP or
                Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val openAppPendingIntent = PendingIntent.getActivity(
            appContext,
            OPEN_APP_REQUEST_CODE,
            openAppIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val stopIntent = Intent(appContext, QuickTimerNotificationReceiver::class.java).apply {
            action = QuickTimerNotificationReceiver.ACTION_STOP_ACTIVE_TIMER
        }
        val stopPendingIntent = PendingIntent.getBroadcast(
            appContext,
            STOP_ACTION_REQUEST_CODE,
            stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val stopAction = NotificationCompat.Action.Builder(
            R.drawable.ic_qs_timer,
            "Arrêter",
            stopPendingIntent,
        )
            .setAuthenticationRequired(spec.requireUnlockForStopAction)
            .build()

        val notification = NotificationCompat.Builder(appContext, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_qs_timer_active)
            .setContentTitle(spec.title)
            .setContentText(spec.contentText)
            .setSubText(spec.subText)
            .setWhen(spec.startTs)
            .setShowWhen(true)
            .setUsesChronometer(true)
            .setOngoing(true)
            .setAutoCancel(false)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(openAppPendingIntent)
            .addAction(stopAction)
            .build()

        try {
            nmCompat.notify(NOTIFICATION_ID, notification)
        } catch (_: SecurityException) {
            // POST_NOTIFICATIONS missing or revoked by system settings
        }
    }
}
