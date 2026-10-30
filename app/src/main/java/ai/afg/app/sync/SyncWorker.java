package ai.afg.app.sync;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.TimeUnit;

import ai.afg.app.MainActivity;

public class SyncWorker extends Worker {
    private static final String TAG = "SyncWorker";
    private static final String SYNC_ENDPOINT = "/api/sync";

    public SyncWorker(@NonNull Context context, @NonNull WorkerParameters workerParams) {
        super(context, workerParams);
    }

    @NonNull
    @Override
    public Result doWork() {
        SharedPreferences prefs = getApplicationContext().getSharedPreferences("afg_ai_prefs", Context.MODE_PRIVATE);
        String authToken = prefs.getString("auth_token", null);
        String serverUrl = prefs.getString("server_url", "https://api.afg-ai.app");

        if (authToken == null) {
            Log.d(TAG, "No auth token, skipping sync");
            return Result.success();
        }

        try {
            syncConversations(serverUrl, authToken);
            syncSettings(serverUrl, authToken);

            prefs.edit().putString("last_sync_timestamp", java.time.Instant.now().toString()).apply();
            Log.d(TAG, "Sync completed successfully");
            return Result.success();
        } catch (Exception e) {
            Log.e(TAG, "Sync failed", e);
            return Result.retry();
        }
    }

    private void syncConversations(String serverUrl, String authToken) throws Exception {
        String url = serverUrl + SYNC_ENDPOINT + "/conversations";
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setRequestMethod("GET");
        conn.setRequestProperty("Authorization", "Bearer " + authToken);
        conn.setRequestProperty("Accept", "application/json");
        conn.setConnectTimeout(10000);
        conn.setReadTimeout(30000);

        int responseCode = conn.getResponseCode();
        if (responseCode == 200) {
            BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()));
            StringBuilder response = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                response.append(line);
            }
            reader.close();

            SharedPreferences prefs = getApplicationContext().getSharedPreferences("afg_ai_prefs", Context.MODE_PRIVATE);
            prefs.edit().putString("synced_conversations", response.toString()).apply();

            MainActivity activity = getRunningActivity();
            if (activity != null) {
                activity.runOnUiThread(() -> activity.getWebView().evaluateJavascript(
                    "window.AFG_Android && AFG_Android.onConversationsSynced(" + response + ")", null));
            }
        }
    }

    private void syncSettings(String serverUrl, String authToken) throws Exception {
        String url = serverUrl + SYNC_ENDPOINT + "/settings";
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setRequestMethod("GET");
        conn.setRequestProperty("Authorization", "Bearer " + authToken);
        conn.setRequestProperty("Accept", "application/json");
        conn.setConnectTimeout(5000);
        conn.setReadTimeout(15000);

        int responseCode = conn.getResponseCode();
        if (responseCode == 200) {
            BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()));
            StringBuilder response = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                response.append(line);
            }
            reader.close();

            SharedPreferences prefs = getApplicationContext().getSharedPreferences("afg_ai_prefs", Context.MODE_PRIVATE);
            prefs.edit().putString("synced_settings", response.toString()).apply();
        }
    }

    private MainActivity getRunningActivity() {
        try {
            Class<?> activityThreadClass = Class.forName("android.app.ActivityThread");
            Object activityThread = activityThreadClass.getMethod("currentActivityThread").invoke(null);
            Object activities = activityThreadClass.getField("mActivities").get(activityThread);
            // Simplified - in production, iterate through activities
            return null;
        } catch (Exception e) {
            return null;
        }
    }

    public static void uploadConversation(Context context, String conversationJson) {
        SharedPreferences prefs = context.getSharedPreferences("afg_ai_prefs", Context.MODE_PRIVATE);
        String authToken = prefs.getString("auth_token", null);
        String serverUrl = prefs.getString("server_url", "https://api.afg-ai.app");

        if (authToken == null) return;

        new Thread(() -> {
            try {
                String url = serverUrl + SYNC_ENDPOINT + "/conversations";
                HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Authorization", "Bearer " + authToken);
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setDoOutput(true);
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(30000);

                try (OutputStream os = conn.getOutputStream()) {
                    os.write(conversationJson.getBytes("UTF-8"));
                }

                int responseCode = conn.getResponseCode();
                if (responseCode >= 200 && responseCode < 300) {
                    Log.d(TAG, "Conversation uploaded successfully");
                }
            } catch (Exception e) {
                Log.e(TAG, "Failed to upload conversation", e);
            }
        }).start();
    }
}