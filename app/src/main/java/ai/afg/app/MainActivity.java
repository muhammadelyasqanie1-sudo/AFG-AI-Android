package ai.afg.app;

import android.app.Activity;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.graphics.Bitmap;
import android.graphics.drawable.Icon;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.text.TextUtils;
import android.util.Log;
import android.view.KeyEvent;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.RequiresApi;
import androidx.appcompat.app.AppCompatDelegate;
import androidx.biometric.BiometricPrompt;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.core.graphics.drawable.IconCompat;
import androidx.lifecycle.Lifecycle;
import androidx.lifecycle.LifecycleObserver;
import androidx.lifecycle.OnLifecycleEvent;
import androidx.lifecycle.ProcessLifecycleOwner;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.WorkRequest;

import java.io.File;
import java.io.IOException;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.TimeUnit;

public class MainActivity extends Activity implements LifecycleObserver {
    private static final String TAG = "AFGMainActivity";
    private static final String APP_URL = "https://appassets.androidplatform.net/assets/index.html";
    private static final int FILE_CHOOSER_REQUEST_CODE = 1001;
    private static final int BIOMETRIC_REQUEST_CODE = 1002;
    private static final int SHARE_REQUEST_CODE = 1003;
    private static final long SYNC_INTERVAL_MS = 15 * 60 * 1000;

    private WebView webView;
    private WebViewAssetLoader assetLoader;
    private ValueCallback<Uri[]> filePathCallback;
    private Uri cameraOutputUri;
    private volatile boolean cameraModeRequested = false;
    private BiometricPrompt biometricPrompt;
    private BiometricPrompt.CryptoObject cryptoObject;
    private Handler syncHandler = new Handler(Looper.getMainLooper());
    private Runnable syncRunnable;
    private SharedPreferences prefs;
    private boolean isInPictureInPicture = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences("afg_ai_prefs", MODE_PRIVATE);

        applyTheme();
        setupAssetLoader();
        setupWebView();
        setupBiometricPrompt();
        setupShortcuts();
        setupPictureInPicture();
        handleIntents(getIntent());
        startBackgroundSync();
        registerLifecycleObserver();

        setContentView(webView);
    }

    private void applyTheme() {
        int themeMode = prefs.getInt("theme_mode", AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM);
        AppCompatDelegate.setDefaultNightMode(themeMode);
    }

    private void setupAssetLoader() {
        assetLoader = new WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
            .addPathHandler("/storage/", new WebViewAssetLoader.InternalStoragePathHandler(this, "web_storage"))
            .build();
    }

    private void setupWebView() {
        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setAppCacheEnabled(true);
        settings.setAppCachePath(getCacheDir().getAbsolutePath());
        settings.setDatabaseEnabled(true);
        settings.setDatabasePath(getFilesDir().getAbsolutePath());
        settings.setGeolocationEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportZoom(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        settings.setLayoutAlgorithm(WebSettings.LayoutAlgorithm.TEXT_AUTOSIZING);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setTextZoom(100);
        settings.setSafeBrowsingEnabled(true);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            settings.setSafeBrowsingAllowed(true);
        }

        addJavascriptInterfaces();
        setupWebChromeClient();
        setupWebViewClient();
        enableOfflineSupport();
    }

    private void addJavascriptInterfaces() {
        webView.addJavascriptInterface(new Object() {
            @JavascriptInterface public void setCameraMode(boolean enabled) {
                cameraModeRequested = enabled;
            }
            @JavascriptInterface public void requestBiometricAuth(String reason) {
                runOnUiThread(() -> authenticateWithBiometric(reason));
            }
            @JavascriptInterface public void getTheme() {
                String theme = prefs.getString("ui_theme", "system");
                webView.post(() -> webView.evaluateJavascript(
                    "window.AFG_Android && AFG_Android.onTheme('" + theme + "')", null));
            }
            @JavascriptInterface public void setTheme(String theme) {
                prefs.edit().putString("ui_theme", theme).apply();
                recreate();
            }
            @JavascriptInterface public void shareContent(String title, String text, String url) {
                runOnUiThread(() -> shareContentImpl(title, text, url));
            }
            @JavascriptInterface public void openExternalUrl(String url) {
                runOnUiThread(() -> {
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(intent);
                });
            }
            @JavascriptInterface public void vibrate(long milliseconds) {
                android.os.Vibrator vibrator = (android.os.Vibrator) getSystemService(VIBRATOR_SERVICE);
                if (vibrator != null && vibrator.hasVibrator()) {
                    vibrator.vibrate(milliseconds);
                }
            }
            @JavascriptInterface public void requestPinShortcut() {
                runOnUiThread(() -> pinShortcut());
            }
            @JavascriptInterface public void isOffline() {
                boolean offline = !isNetworkAvailable();
                webView.post(() -> webView.evaluateJavascript(
                    "window.AFG_Android && AFG_Android.onOfflineStatus(" + offline + ")", null));
            }
        }, "AFGAndroid");

        webView.addJavascriptInterface(new Object() {
            @JavascriptInterface public void log(String message) {
                Log.d("AFG_WebView", message);
            }
        }, "AFGLog");
    }

    private void setupWebChromeClient() {
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = callback;

                try {
                    boolean wantsImage = false;
                    String[] acceptTypes = params.getAcceptTypes();
                    if (acceptTypes != null) {
                        for (String type : acceptTypes) {
                            if (type != null && (type.startsWith("image/") || type.equals("*/*"))) {
                                wantsImage = true;
                                break;
                            }
                        }
                    }
                    boolean forceCamera = cameraModeRequested;
                    cameraModeRequested = false;
                    if ((forceCamera || params.isCaptureEnabled()) && wantsImage) {
                        Intent cameraIntent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                        if (cameraIntent.resolveActivity(getPackageManager()) != null) {
                            File output = File.createTempFile("afg-ai-camera-", ".jpg", getCacheDir());
                            cameraOutputUri = FileProvider.getUriForFile(
                                MainActivity.this, getPackageName() + ".fileprovider", output);
                            cameraIntent.putExtra(MediaStore.EXTRA_OUTPUT, cameraOutputUri);
                            cameraIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                            startActivityForResult(cameraIntent, FILE_CHOOSER_REQUEST_CODE);
                            return true;
                        }
                    }

                    Intent chooserIntent = params.createIntent();
                    startActivityForResult(Intent.createChooser(chooserIntent, "Choose photo or file"), FILE_CHOOSER_REQUEST_CODE);
                    return true;
                } catch (Exception error) {
                    cameraModeRequested = false;
                    cameraOutputUri = null;
                    filePathCallback = null;
                    callback.onReceiveValue(null);
                    return false;
                }
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    request.grant(request.getResources());
                }
            }

            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                super.onProgressChanged(view, newProgress);
            }
        });
    }

    private void setupWebViewClient() {
        webView.setWebViewClient(new WebViewClientCompat() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("mvvvfnjwjgwxenywazqx.supabase.co".equals(uri.getHost())
                        && "/auth/v1/authorize".equals(uri.getPath())) {
                    try {
                        Intent browserIntent = new Intent(Intent.ACTION_VIEW, uri);
                        startActivity(browserIntent);
                    } catch (Exception ignored) { }
                    return true;
                }
                if (uri.getScheme().startsWith("http")) {
                    return false;
                }
                try {
                    Intent intent = new Intent(Intent.ACTION_VIEW, uri);
                    startActivity(intent);
                    return true;
                } catch (Exception e) {
                    return false;
                }
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                injectThemeCss();
                webView.evaluateJavascript("window.AFG_Android && AFG_Android.onReady()", null);
            }

            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                super.onReceivedError(view, errorCode, description, failingUrl);
                if (!isNetworkAvailable()) {
                    loadOfflinePage();
                }
            }
        });
    }

    private void enableOfflineSupport() {
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        CookieManager.getInstance().setAcceptCookie(true);

        webView.getSettings().setCacheMode(WebSettings.LOAD_CACHE_ELSE_NETWORK);
    }

    private void injectThemeCss() {
        String theme = prefs.getString("ui_theme", "system");
        String css = "";
        switch (theme) {
            case "cyberpunk":
                css = "html { --theme: cyberpunk; }";
                break;
            case "minimal":
                css = "html { --theme: minimal; }";
                break;
            case "premium":
                css = "html { --theme: premium; }";
                break;
        }
        if (!css.isEmpty()) {
            webView.evaluateJavascript("(function() { var style = document.createElement('style'); style.textContent = '" + css + "'; document.head.appendChild(style); })();", null);
        }
    }

    private void loadOfflinePage() {
        String offlineHtml = "<html><head><meta name='viewport' content='width=device-width, initial-scale=1'><style>body{font-family:sans-serif;text-align:center;padding:2rem;background:#0a0f1a;color:#e0e6ed}button{padding:0.8rem 1.5rem;background:#00d4aa;border:none;border-radius:8px;color:#0a0f1a;font-weight:600;cursor:pointer}</style></head><body><h1>You're Offline</h1><p>Check your connection and try again.</p><button onclick='location.reload()'>Retry</button></body></html>";
        webView.loadDataWithBaseURL(null, offlineHtml, "text/html", "utf-8", null);
    }

    private void setupBiometricPrompt() {
        BiometricManager biometricManager = BiometricManager.from(this);
        int canAuthenticate = biometricManager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG | BiometricManager.Authenticators.DEVICE_CREDENTIAL);

        if (canAuthenticate == BiometricManager.BIOMETRIC_SUCCESS) {
            biometricPrompt = new BiometricPrompt(this,
                ContextCompat.getMainExecutor(this),
                new BiometricPrompt.AuthenticationCallback() {
                    @Override
                    public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                        webView.evaluateJavascript("window.AFG_Android && AFG_Android.onBiometricSuccess()", null);
                    }

                    @Override
                    public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                        webView.evaluateJavascript("window.AFG_Android && AFG_Android.onBiometricError('" + errString + "')", null);
                    }

                    @Override
                    public void onAuthenticationFailed() {
                        webView.evaluateJavascript("window.AFG_Android && AFG_Android.onBiometricFailed()", null);
                    }
                });
        }
    }

    private void authenticateWithBiometric(String reason) {
        if (biometricPrompt != null) {
            BiometricPrompt.PromptInfo promptInfo = new BiometricPrompt.PromptInfo.Builder()
                .setTitle("AFG AI Authentication")
                .setSubtitle(reason)
                .setNegativeButtonText("Cancel")
                .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG | BiometricManager.Authenticators.DEVICE_CREDENTIAL)
                .build();
            biometricPrompt.authenticate(promptInfo);
        }
    }

    private void setupShortcuts() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N_MR1) {
            ShortcutManager shortcutManager = getSystemService(ShortcutManager.class);
            if (shortcutManager != null) {
                List<ShortcutInfo> dynamicShortcuts = Arrays.asList(
                    new ShortcutInfo.Builder(this, "new_chat")
                        .setShortLabel("New Chat")
                        .setLongLabel("Start a new conversation")
                        .setIcon(Icon.createWithResource(this, android.R.drawable.ic_menu_add))
                        .setIntent(new Intent(Intent.ACTION_VIEW, Uri.parse("afgai://new_chat")))
                        .setRank(0)
                        .build(),
                    new ShortcutInfo.Builder(this, "voice_chat")
                        .setShortLabel("Voice Chat")
                        .setLongLabel("Start voice conversation")
                        .setIcon(Icon.createWithResource(this, android.R.drawable.ic_btn_speak_now))
                        .setIntent(new Intent(Intent.ACTION_VIEW, Uri.parse("afgai://voice_chat")))
                        .setRank(1)
                        .build(),
                    new ShortcutInfo.Builder(this, "recent")
                        .setShortLabel("Recent")
                        .setLongLabel("View recent conversations")
                        .setIcon(Icon.createWithResource(this, android.R.drawable.ic_menu_recent_history))
                        .setIntent(new Intent(Intent.ACTION_VIEW, Uri.parse("afgai://recent")))
                        .setRank(2)
                        .build()
                );
                shortcutManager.setDynamicShortcuts(dynamicShortcuts);
            }
        }
    }

    private void pinShortcut() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ShortcutManager shortcutManager = getSystemService(ShortcutManager.class);
            if (shortcutManager != null && shortcutManager.isRequestPinShortcutSupported()) {
                ShortcutInfo pinShortcutInfo = new ShortcutInfo.Builder(this, "pinned_chat")
                    .setShortLabel("AFG AI")
                    .setLongLabel("Open AFG AI")
                    .setIcon(Icon.createWithResource(this, android.R.drawable.ic_launcher))
                    .setIntent(new Intent(Intent.ACTION_MAIN).setClass(this, MainActivity.class))
                    .build();
                Intent pinnedShortcutCallbackIntent = shortcutManager.createShortcutResultIntent(pinShortcutInfo);
                startActivityForResult(pinnedShortcutCallbackIntent, SHARE_REQUEST_CODE);
            }
        }
    }

    private void setupPictureInPicture() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            setPictureInPictureParams(new android.app.PictureInPictureParams.Builder()
                .setAspectRatio(new android.util.Rational(16, 9))
                .setActions(
                    new android.app.RemoteAction(Icon.createWithResource(this, android.R.drawable.ic_media_play), "Play", "Play", PendingIntent.getBroadcast(this, 0, new Intent("ai.afg.app.ACTION_PIP_PLAY"), PendingIntent.FLAG_IMMUTABLE)),
                    new android.app.RemoteAction(Icon.createWithResource(this, android.R.drawable.ic_media_pause), "Pause", "Pause", PendingIntent.getBroadcast(this, 0, new Intent("ai.afg.app.ACTION_PIP_PAUSE"), PendingIntent.FLAG_IMMUTABLE))
                )
                .build());
        }
    }

    @Override
    @RequiresApi(api = Build.VERSION_CODES.O)
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, android.app.PictureInPictureParams newParams) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newParams);
        isInPictureInPicture = isInPictureInPictureMode;
        webView.evaluateJavascript("window.AFG_Android && AFG_Android.onPipModeChanged(" + isInPictureInPictureMode + ")", null);
    }

    private void handleIntents(Intent intent) {
        if (intent == null) return;

        String action = intent.getAction();
        String type = intent.getType();
        Uri data = intent.getData();

        if (Intent.ACTION_SEND.equals(action) && type != null) {
            handleSendIntent(intent);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action) && type != null) {
            handleSendMultipleIntent(intent);
        } else if (Intent.ACTION_VIEW.equals(action) && data != null) {
            handleViewIntent(data);
        } else if ("ai.afg.app.ACTION_NEW_CHAT".equals(action)) {
            webView.loadUrl(APP_URL + "#new-chat");
        } else if ("ai.afg.app.ACTION_VOICE_CHAT".equals(action)) {
            webView.loadUrl(APP_URL + "#voice-chat");
        }
    }

    private void handleSendIntent(Intent intent) {
        String type = intent.getType();
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        Uri uri = (Uri) intent.getParcelableExtra(Intent.EXTRA_STREAM);

        String payload = "";
        if (text != null) payload += text;
        if (uri != null) payload += "\n[Attachment: " + uri.toString() + "]";

        webView.evaluateJavascript("window.AFG_Android && AFG_Android.onShareReceived('" + escapeJs(payload) + "')", null);
    }

    private void handleSendMultipleIntent(Intent intent) {
        String type = intent.getType();
        java.util.ArrayList<Uri> uris = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);

        StringBuilder payload = new StringBuilder();
        if (text != null) payload.append(text);
        if (uris != null) {
            for (Uri uri : uris) {
                payload.append("\n[Attachment: ").append(uri.toString()).append("]");
            }
        }
        webView.evaluateJavascript("window.AFG_Android && AFG_Android.onShareReceived('" + escapeJs(payload.toString()) + "')", null);
    }

    private void handleViewIntent(Uri data) {
        if ("afgai".equals(data.getScheme()) && "auth-callback".equals(data.getHost())) {
            String fragment = data.getEncodedFragment();
            if (fragment != null && !fragment.isEmpty()) {
                webView.loadUrl(APP_URL + "#" + fragment);
                return;
            }
            String query = data.getEncodedQuery();
            if (query != null && !query.isEmpty()) {
                webView.loadUrl(APP_URL + "#" + query);
                return;
            }
        }
        webView.loadUrl(APP_URL);
    }

    private String escapeJs(String s) {
        return s.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n").replace("\r", "\\r");
    }

    private void shareContentImpl(String title, String text, String url) {
        Intent shareIntent = new Intent(Intent.ACTION_SEND);
        shareIntent.setType("text/plain");
        if (title != null) shareIntent.putExtra(Intent.EXTRA_SUBJECT, title);
        StringBuilder body = new StringBuilder();
        if (text != null) body.append(text);
        if (url != null) body.append("\n").append(url);
        shareIntent.putExtra(Intent.EXTRA_TEXT, body.toString());
        startActivity(Intent.createChooser(shareIntent, "Share via"));
    }

    private void startBackgroundSync() {
        Constraints constraints = new Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .setRequiresBatteryNotLow(true)
            .build();

        PeriodicWorkRequest syncWork = new PeriodicWorkRequest.Builder(SyncWorker.class, 15, TimeUnit.MINUTES)
            .setConstraints(constraints)
            .build();

        WorkManager.getInstance(this).enqueueUniquePeriodicWork(
            "afg_sync",
            ExistingPeriodicWorkPolicy.KEEP,
            syncWork
        );
    }

    private void registerLifecycleObserver() {
        ProcessLifecycleOwner.get().getLifecycle().addObserver(this);
    }

    @OnLifecycleEvent(Lifecycle.Event.ON_STOP)
    public void onAppBackgrounded() {
        saveWebViewState();
        schedulePeriodicSync();
    }

    @OnLifecycleEvent(Lifecycle.Event.ON_START)
    public void onAppForegrounded() {
        cancelPeriodicSync();
        restoreWebViewState();
    }

    private void saveWebViewState() {
        Bundle state = new Bundle();
        webView.saveState(state);
        prefs.edit().putString("webview_state", android.util.Base64.encodeToString(serializeBundle(state), android.util.Base64.DEFAULT)).apply();
    }

    private void restoreWebViewState() {
        String encoded = prefs.getString("webview_state", null);
        if (encoded != null) {
            try {
                byte[] data = android.util.Base64.decode(encoded, android.util.Base64.DEFAULT);
                Bundle state = deserializeBundle(data);
                webView.restoreState(state);
            } catch (Exception e) {
                Log.w(TAG, "Failed to restore WebView state", e);
            }
        }
    }

    private byte[] serializeBundle(Bundle bundle) {
        android.os.Parcel parcel = android.os.Parcel.obtain();
        bundle.writeToParcel(parcel, 0);
        byte[] bytes = parcel.marshall();
        parcel.recycle();
        return bytes;
    }

    private Bundle deserializeBundle(byte[] data) {
        android.os.Parcel parcel = android.os.Parcel.obtain();
        parcel.unmarshall(data, 0, data.length);
        parcel.setDataPosition(0);
        Bundle bundle = Bundle.CREATOR.createFromParcel(parcel);
        parcel.recycle();
        return bundle;
    }

    private void schedulePeriodicSync() {
        syncRunnable = () -> {
            WorkManager.getInstance(this).enqueueUniqueWork(
                "afg_periodic_sync",
                ExistingPeriodicWorkPolicy.KEEP,
                new OneTimeWorkRequest.Builder(SyncWorker.class).build()
            );
            syncHandler.postDelayed(syncRunnable, SYNC_INTERVAL_MS);
        };
        syncHandler.postDelayed(syncRunnable, SYNC_INTERVAL_MS);
    }

    private void cancelPeriodicSync() {
        if (syncRunnable != null) {
            syncHandler.removeCallbacks(syncRunnable);
        }
    }

    private boolean isNetworkAvailable() {
        android.net.ConnectivityManager cm = (android.net.ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm != null) {
            android.net.NetworkCapabilities capabilities = cm.getNetworkCapabilities(cm.getActiveNetwork());
            return capabilities != null && (
                capabilities.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI) ||
                capabilities.hasTransport(android.net.NetworkCapabilities.TRANSPORT_CELLULAR) ||
                capabilities.hasTransport(android.net.NetworkCapabilities.TRANSPORT_ETHERNET)
            );
        }
        return false;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode == FILE_CHOOSER_REQUEST_CODE) {
            handleFileChooserResult(resultCode, data);
        } else if (requestCode == SHARE_REQUEST_CODE) {
        } else if (requestCode == BIOMETRIC_REQUEST_CODE) {
        }
    }

    private void handleFileChooserResult(int resultCode, Intent data) {
        if (filePathCallback == null) return;

        Uri[] results = null;
        if (resultCode == RESULT_OK) {
            if (cameraOutputUri != null) {
                results = new Uri[] { cameraOutputUri };
            } else if (data != null && data.getClipData() != null) {
                int count = data.getClipData().getItemCount();
                results = new Uri[count];
                for (int i = 0; i < count; i++) {
                    results[i] = data.getClipData().getItemAt(i).getUri();
                }
            } else if (data != null && data.getData() != null) {
                results = new Uri[] { data.getData() };
            }
        }
        cameraOutputUri = null;
        filePathCallback.onReceiveValue(results);
        filePathCallback = null;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntents(intent);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView != null && webView.canGoBack()) {
            webView.goBack();
            return true;
        }
        if (event.isCtrlPressed()) {
            switch (keyCode) {
                case KeyEvent.KEYCODE_N:
                    webView.evaluateJavascript("window.AFG_Android && AFG_Android.onShortcut('new_chat')", null);
                    return true;
                case KeyEvent.KEYCODE_F:
                    webView.evaluateJavascript("window.AFG_Android && AFG_Android.onShortcut('find')", null);
                    return true;
                case KeyEvent.KEYCODE_K:
                    webView.evaluateJavascript("window.AFG_Android && AFG_Android.onShortcut('command_palette')", null);
                    return true;
                case KeyEvent.KEYCODE_M:
                    webView.evaluateJavascript("window.AFG_Android && AFG_Android.onShortcut('toggle_theme')", null);
                    return true;
            }
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public void onBackPressed() {
        if (isInPictureInPicture) {
            super.onBackPressed();
        } else if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            moveTaskToBack(true);
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        cancelPeriodicSync();
        ProcessLifecycleOwner.get().getLifecycle().removeObserver(this);
        if (webView != null) {
            webView.destroy();
        }
    }
}