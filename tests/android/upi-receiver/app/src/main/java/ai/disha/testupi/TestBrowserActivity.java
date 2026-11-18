package ai.disha.testupi;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebChromeClient;
import android.content.Intent;
import android.net.Uri;
import android.util.Log;
import android.widget.TextView;
import android.view.ViewGroup;

public final class TestBrowserActivity extends Activity {
    private WebView webView;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        webView = new WebView(this);
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("upi".equalsIgnoreCase(uri.getScheme()) && "pay".equalsIgnoreCase(uri.getHost())) {
                    Log.i("DISHA_UPI_TEST", "ANDROID_WEBVIEW_DISPATCH " + uri.getScheme());
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    } catch (Exception error) {
                        Log.e("DISHA_UPI_TEST", "UPI_HANDLER_UNAVAILABLE", error);
                    }
                    return true;
                }
                return false;
            }
        });
        webView.setWebChromeClient(new WebChromeClient());
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setLoadsImagesAutomatically(true);
        setContentView(webView, new ViewGroup.LayoutParams(-1,-1));
        String url = getIntent().getStringExtra("url");
        if (url == null || !url.startsWith("http://10.0.2.2:8765/")) {
            TextView blocked=new TextView(this);
            blocked.setText("TEST-ONLY FIXTURE URL REQUIRED");
            setContentView(blocked);
            return;
        }
        Log.i("DISHA_UPI_TEST", "OPEN_CHECKOUT_FIXTURE");
        webView.loadUrl(url);
    }
    @Override public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }
    @Override protected void onDestroy() {
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}
