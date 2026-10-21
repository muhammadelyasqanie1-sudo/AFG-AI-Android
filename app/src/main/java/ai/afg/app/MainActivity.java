package ai.afg.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;

public class MainActivity extends Activity {
    private static final String APP_URL = "https://appassets.androidplatform.net/assets/index.html";
    private WebView webView;
    private WebViewAssetLoader assetLoader;

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
        settings.setAllowContentAccess(false);
        webView.setWebViewClient(new WebViewClientCompat() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }
        });
        setContentView(webView);
        loadAppWithAuthCallback(getIntent());
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
