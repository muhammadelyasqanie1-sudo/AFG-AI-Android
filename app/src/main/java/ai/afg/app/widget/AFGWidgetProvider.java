package ai.afg.app.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

import ai.afg.app.R;

public class AFGWidgetProvider extends AppWidgetProvider {
    private static final String ACTION_NEW_CHAT = "ai.afg.app.ACTION_NEW_CHAT";
    private static final String ACTION_VOICE_CHAT = "ai.afg.app.ACTION_VOICE_CHAT";
    private static final String ACTION_REFRESH = "ai.afg.app.ACTION_WIDGET_REFRESH";

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId);
        }
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (ACTION_REFRESH.equals(intent.getAction())) {
            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            ComponentName component = new ComponentName(context, AFGWidgetProvider.class);
            int[] ids = manager.getAppWidgetIds(component);
            onUpdate(context, manager, ids);
        }
    }

    static void updateAppWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_layout);

        SharedPreferences prefs = context.getSharedPreferences("afg_ai_prefs", Context.MODE_PRIVATE);
        String lastConversation = prefs.getString("last_conversation_title", "No recent chats");
        String lastModel = prefs.getString("last_model_used", "auto");

        views.setTextViewText(R.id.widget_title, "AFG AI");
        views.setTextViewText(R.id.widget_last_chat, lastConversation);
        views.setTextViewText(R.id.widget_model, "Model: " + lastModel);

        Intent newChatIntent = new Intent(context, ai.afg.app.MainActivity.class);
        newChatIntent.setAction(ACTION_NEW_CHAT);
        newChatIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent newChatPending = PendingIntent.getActivity(
            context, 0, newChatIntent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        views.setOnClickPendingIntent(R.id.widget_new_chat, newChatPending);

        Intent voiceChatIntent = new Intent(context, ai.afg.app.MainActivity.class);
        voiceChatIntent.setAction(ACTION_VOICE_CHAT);
        voiceChatIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent voiceChatPending = PendingIntent.getActivity(
            context, 1, voiceChatIntent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        views.setOnClickPendingIntent(R.id.widget_voice_chat, voiceChatPending);

        Intent mainIntent = new Intent(context, ai.afg.app.MainActivity.class);
        mainIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent mainPending = PendingIntent.getActivity(
            context, 2, mainIntent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        views.setOnClickPendingIntent(R.id.widget_container, mainPending);

        Intent refreshIntent = new Intent(context, AFGWidgetProvider.class);
        refreshIntent.setAction(ACTION_REFRESH);
        PendingIntent refreshPending = PendingIntent.getBroadcast(
            context, 3, refreshIntent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        views.setOnClickPendingIntent(R.id.widget_refresh, refreshPending);

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }

    public static void triggerRefresh(Context context) {
        Intent intent = new Intent(ACTION_REFRESH);
        context.sendBroadcast(intent);
    }

    public static void updateWidgetData(Context context, String conversationTitle, String modelName) {
        SharedPreferences prefs = context.getSharedPreferences("afg_ai_prefs", Context.MODE_PRIVATE);
        prefs.edit()
            .putString("last_conversation_title", conversationTitle)
            .putString("last_model_used", modelName)
            .apply();
        triggerRefresh(context);
    }
}