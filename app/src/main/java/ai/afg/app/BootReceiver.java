package ai.afg.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Log;

import ai.afg.app.notification.NotificationService;
import ai.afg.app.sync.SyncService;

public class BootReceiver extends BroadcastReceiver {
    private static final String TAG = "BootReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        Log.d(TAG, "Received boot action: " + action);

        if (Intent.ACTION_BOOT_COMPLETED.equals(action) ||
            Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {

            SharedPreferences prefs = context.getSharedPreferences("afg_ai_prefs", Context.MODE_PRIVATE);

            if (prefs.getBoolean("notifications_enabled", true)) {
                Intent notificationIntent = new Intent(context, NotificationService.class);
                context.startForegroundService(notificationIntent);
            }

            if (prefs.getBoolean("auto_sync_enabled", true)) {
                Intent syncIntent = new Intent(context, SyncService.class);
                context.startForegroundService(syncIntent);
            }

            if (prefs.getBoolean("widget_enabled", true)) {
                ai.afg.app.widget.AFGWidgetProvider.triggerRefresh(context);
            }

            Log.d(TAG, "BootReceiver: Services started");
        }
    }
}