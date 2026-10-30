package ai.afg.app.widget;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.view.View;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Spinner;

import ai.afg.app.R;

public class WidgetConfigActivity extends Activity {
    private int widgetId = AppWidgetManager.INVALID_APPWIDGET_ID;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.widget_config);

        Intent intent = getIntent();
        Bundle extras = intent.getExtras();
        if (extras != null) {
            widgetId = extras.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        }

        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish();
            return;
        }

        Spinner sizeSpinner = findViewById(R.id.config_size_spinner);
        Spinner themeSpinner = findViewById(R.id.config_theme_spinner);

        ArrayAdapter<CharSequence> sizeAdapter = ArrayAdapter.createFromResource(
            this, R.array.widget_sizes, android.R.layout.simple_spinner_item);
        sizeAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        sizeSpinner.setAdapter(sizeAdapter);

        ArrayAdapter<CharSequence> themeAdapter = ArrayAdapter.createFromResource(
            this, R.array.widget_themes, android.R.layout.simple_spinner_item);
        themeAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        themeSpinner.setAdapter(themeAdapter);

        SharedPreferences prefs = getSharedPreferences("afg_ai_prefs", Context.MODE_PRIVATE);
        sizeSpinner.setSelection(prefs.getInt("widget_size_" + widgetId, 0));
        themeSpinner.setSelection(prefs.getInt("widget_theme_" + widgetId, 0));

        findViewById(R.id.config_save).setOnClickListener(v -> {
            prefs.edit()
                .putInt("widget_size_" + widgetId, sizeSpinner.getSelectedItemPosition())
                .putInt("widget_theme_" + widgetId, themeSpinner.getSelectedItemPosition())
                .apply();

            Intent result = new Intent();
            result.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
            setResult(RESULT_OK, result);
            AFGWidgetProvider.updateAppWidget(this, AppWidgetManager.getInstance(this), widgetId);
            finish();
        });

        findViewById(R.id.config_cancel).setOnClickListener(v -> {
            setResult(RESULT_CANCELED);
            finish();
        });
    }
}