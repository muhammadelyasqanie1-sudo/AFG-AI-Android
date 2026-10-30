package ai.afg.app.notification;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import ai.afg.app.MainActivity;
import ai.afg.app.R;

public class NotificationService extends Service {
    private static final String TAG = "NotificationService";
    public static final String CHANNEL_ID = "afg_ai_notifications";
    public static final String CHANNEL_NAME = "AFG AI Notifications";
    public static final String CHANNEL_DESCRIPTION = "Notifications for new messages, sync status, and updates";

    public static final String ACTION_SHOW_NOTIFICATION = "ai.afg.app.ACTION_SHOW_NOTIFICATION";
    public static final String ACTION_DISMISS_NOTIFICATION = "ai.afg.app.ACTION_DISMISS_NOTIFICATION";
    public static final String EXTRA_NOTIFICATION_ID = "notification_id";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_MESSAGE = "message";
    public static final String EXTRA_ACTION = "action";
    public static final String EXTRA_DATA = "data";

    private NotificationManagerCompat notificationManager;
    private SharedPreferences prefs;

    @Override
    public void onCreate() {
        super.onCreate();
        notificationManager = NotificationManagerCompat.from(this);
        prefs = getSharedPreferences("afg_ai_prefs", Context.MODE_PRIVATE);
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            String action = intent.getAction();
            if (ACTION_SHOW_NOTIFICATION.equals(action)) {
                showNotification(
                    intent.getIntExtra(EXTRA_NOTIFICATION_ID, 1),
                    intent.getStringExtra(EXTRA_TITLE),
                    intent.getStringExtra(EXTRA_MESSAGE),
                    intent.getStringExtra(EXTRA_ACTION),
                    intent.getStringExtra(EXTRA_DATA)
                );
            } else if (ACTION_DISMISS_NOTIFICATION.equals(action)) {
                dismissNotification(intent.getIntExtra(EXTRA_NOTIFICATION_ID, 1));
            }
        }
        return START_STICKY;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_DEFAULT
            );
            channel.setDescription(CHANNEL_DESCRIPTION);
            channel.enableLights(true);
            channel.setLightColor(Color.parseColor("#00D4AA"));
            channel.enableVibration(true);
            channel.setVibrationPattern(new long[]{0, 100, 200, 100});

            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    public void showNotification(int id, String title, String message, String action, String data) {
        if (!prefs.getBoolean("notifications_enabled", true)) return;

        Intent mainIntent = new Intent(this, MainActivity.class);
        mainIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (action != null) {
            mainIntent.setAction(action);
        }
        if (data != null) {
            mainIntent.putExtra("notification_data", data);
        }
        PendingIntent contentIntent = PendingIntent.getActivity(
            this, id, mainIntent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        Intent dismissIntent = new Intent(this, NotificationService.class);
        dismissIntent.setAction(ACTION_DISMISS_NOTIFICATION);
        dismissIntent.putExtra(EXTRA_NOTIFICATION_ID, id);
        PendingIntent dismissPending = PendingIntent.getService(
            this, id, dismissIntent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setLargeIcon(createLargeIcon())
            .setContentTitle(title != null ? title : "AFG AI")
            .setContentText(message != null ? message : "New message")
            .setStyle(new NotificationCompat.BigTextStyle().bigText(message))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setContentIntent(contentIntent)
            .setDeleteIntent(dismissPending)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setColor(Color.parseColor("#00D4AA"))
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder.setChannelId(CHANNEL_ID);
        }

        notificationManager.notify(id, builder.build());
    }

    private Bitmap createLargeIcon() {
        Bitmap bitmap = Bitmap.createBitmap(128, 128, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        Paint paint = new Paint();
        paint.setColor(Color.parseColor("#00D4AA"));
        paint.setStyle(Paint.Style.FILL);
        paint.setAntiAlias(true);
        canvas.drawCircle(64, 64, 64, paint);
        paint.setColor(Color.parseColor("#0A0F1A"));
        paint.setTextSize(60);
        paint.setTypeface(Typeface.DEFAULT_BOLD);
        paint.setTextAlign(Paint.Align.CENTER);
        canvas.drawText("AI", 64, 82, paint);
        return bitmap;
    }

    public void dismissNotification(int id) {
        notificationManager.cancel(id);
    }

    public void dismissAllNotifications() {
        notificationManager.cancelAll();
    }

    public static void sendNotification(Context context, int id, String title, String message, String action, String data) {
        Intent intent = new Intent(context, NotificationService.class);
        intent.setAction(ACTION_SHOW_NOTIFICATION);
        intent.putExtra(EXTRA_NOTIFICATION_ID, id);
        intent.putExtra(EXTRA_TITLE, title);
        intent.putExtra(EXTRA_MESSAGE, message);
        intent.putExtra(EXTRA_ACTION, action);
        intent.putExtra(EXTRA_DATA, data);
        ContextCompat.startForegroundService(context, intent);
    }

    public static void sendMessageNotification(Context context, String senderName, String message, String conversationId) {
        String action = "ai.afg.app.ACTION_OPEN_CONVERSATION";
        String data = "conversation_id=" + conversationId;
        sendNotification(context, (int) System.currentTimeMillis(), senderName, message, action, data);
    }

    public static void sendSyncNotification(Context context, boolean success, String details) {
        String title = success ? "Sync Complete" : "Sync Failed";
        String message = success ? "Your conversations are up to date" : "Sync failed: " + details;
        sendNotification(context, 999, title, message, null, null);
    }

    public static void sendUpdateNotification(Context context, String version, String changelog) {
        sendNotification(context, 998, "Update Available: v" + version, changelog, "ai.afg.app.ACTION_UPDATE", version);
    }
}