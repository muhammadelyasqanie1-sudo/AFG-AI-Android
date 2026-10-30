package ai.afg.app;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.util.Log;

public class BiometricCallbackActivity extends Activity {
    private static final String TAG = "BiometricCallback";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Intent intent = getIntent();
        if (intent != null) {
            boolean success = intent.getBooleanExtra("biometric_success", false);
            String error = intent.getStringExtra("biometric_error");

            Intent resultIntent = new Intent();
            resultIntent.putExtra("biometric_success", success);
            if (error != null) resultIntent.putExtra("biometric_error", error);
            setResult(success ? RESULT_OK : RESULT_CANCELED, resultIntent);
        } else {
            setResult(RESULT_CANCELED);
        }
        finish();
    }
}