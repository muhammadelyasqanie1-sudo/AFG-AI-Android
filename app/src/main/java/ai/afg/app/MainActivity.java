package ai.afg.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.webkit.WebSettings;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;

public class MainActivity extends Activity {
    private static final String APP_URL = "https://appassets.androidplatform.net/assets/index.html";
    private static final int FILE_CHOOSER_REQUEST_CODE = 1001;

    private WebView webView;
    private WebViewAssetLoader assetLoader;
    private ValueCallback<Uri[]> filePathCallback;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        assetLoader = new WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
            .build();

        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        // Content URIs are used only by Android's system file picker.
        settings.setAllowContentAccess(true);
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = callback;

                Intent chooserIntent;
                try {
                    chooserIntent = params.createIntent();
                } catch (Exception ignored) {
                    chooserIntent = new Intent(Intent.ACTION_GET_CONTENT);
                    chooserIntent.addCategory(Intent.CATEGORY_OPENABLE);
                    chooserIntent.setType("*/*");
                }

                try {
                    startActivityForResult(Intent.createChooser(chooserIntent, "Choose a file"), FILE_CHOOSER_REQUEST_CODE);
                    return true;
                } catch (Exception error) {
                    filePathCallback = null;
                    callback.onReceiveValue(null);
                    return false;
                }
            }
        });

        webView.setWebViewClient(new WebViewClientCompat() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("mvvvfnjwjgwxenywazqx.supabase.co".equals(uri.getHost())
                        && "/auth/v1/authorize".equals(uri.getPath())) {
                    try {
                        Intent browserIntent = new Intent(Intent.ACTION_VIEW, uri);
                        startActivity(browserIntent);
                    } catch (Exception ignored) { }
                    return true;
                }
                return false;
            }

            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }
        });

        setContentView(webView);
        loadAppWithAuthCallback(getIntent());
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_CHOOSER_REQUEST_CODE) return;

        if (filePathCallback == null) return;
        Uri[] results = null;
        if (resultCode == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                int count = data.getClipData().getItemCount();
                results = new Uri[count];
                for (int i = 0; i < count; i++) {
                    results[i] = data.getClipData().getItemAt(i).getUri();
                }
            } else if (data.getData() != null) {
                results = new Uri[] { data.getData() };
            }
        }
        filePathCallback.onReceiveValue(results);
        filePathCallback = null;
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        loadAppWithAuthCallback(intent);
    }

    private void loadAppWithAuthCallback(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        if (data != null && "afgai".equals(data.getScheme()) && "auth-callback".equals(data.getHost())) {
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

    @Override public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }
}
