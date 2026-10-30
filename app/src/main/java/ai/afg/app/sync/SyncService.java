package ai.afg.app.sync;

import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.IBinder;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import java.util.concurrent.TimeUnit;

public class SyncService extends Service {
    private static final String TAG = "SyncService";
    private static final String WORK_NAME = "afg_periodic_sync";
    private static final long SYNC_INTERVAL_MINUTES = 15;

    @Override
    public void onCreate() {
        super.onCreate();
        schedulePeriodicSync();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && "FORCE_SYNC".equals(intent.getAction())) {
            performSync();
        }
        return START_STICKY;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void schedulePeriodicSync() {
        Constraints constraints = new Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .setRequiresBatteryNotLow(true)
            .setRequiresStorageNotLow(true)
            .build();

        PeriodicWorkRequest syncWork = new PeriodicWorkRequest.Builder(SyncWorker.class, SYNC_INTERVAL_MINUTES, TimeUnit.MINUTES)
            .setConstraints(constraints)
            .setBackoffCriteria(androidx.work.BackoffPolicy.EXPONENTIAL, 5, TimeUnit.MINUTES)
            .build();

        WorkManager.getInstance(this).enqueueUniquePeriodicWork(
            WORK_NAME,
            ExistingPeriodicWorkPolicy.KEEP,
            syncWork
        );

        Log.d(TAG, "Periodic sync scheduled every " + SYNC_INTERVAL_MINUTES + " minutes");
    }

    private void performSync() {
        SharedPreferences prefs = getSharedPreferences("afg_ai_prefs", Context.MODE_PRIVATE);
        String lastSync = prefs.getString("last_sync_timestamp", "never");
        Log.d(TAG, "Performing sync. Last sync: " + lastSync);

        prefs.edit().putString("last_sync_timestamp", java.time.Instant.now().toString()).apply();

        OneTimeWorkRequest immediateSync = new OneTimeWorkRequest.Builder(SyncWorker.class)
            .setConstraints(new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build())
            .build();

        WorkManager.getInstance(this).enqueue(immediateSync);
    }

    public static void forceSync(Context context) {
        Intent intent = new Intent(context, SyncService.class);
        intent.setAction("FORCE_SYNC");
        ContextCompat.startForegroundService(context, intent);
    }

    public static void cancelSync(Context context) {
        WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME);
    }
}