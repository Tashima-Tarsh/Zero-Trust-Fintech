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
    private static final String TAG = "DISHA_UPI_TEST";
    private WebView webView;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        webView = new WebView(this);
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("upi".equalsIgnoreCase(uri.getScheme()) && "pay".equalsIgnoreCase(uri.getHost())) {
                    Log.i(TAG, "ANDROID_WEBVIEW_DISPATCH upi://pay");
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
                    catch (Exception error) { Log.e(TAG, "UPI_HANDLER_UNAVAILABLE", error); }
                    return true;
                }
                return false;
            }
            @Override public void onPageFinished(WebView view, String url) {
                snapshot();
            }
        });
        webView.setWebChromeClient(new WebChromeClient());
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setLoadsImagesAutomatically(true);
        setContentView(webView, new ViewGroup.LayoutParams(-1,-1));
        String url = getIntent().getStringExtra("url");
        if (url == null || !url.startsWith("http://10.0.2.2:8765/merchant-checkout.html?")) {
            TextView blocked=new TextView(this);
            blocked.setText("TEST-ONLY FIXTURE URL REQUIRED");
            setContentView(blocked);
            return;
        }
        Log.i(TAG,"OPEN_CHECKOUT_FIXTURE");
        webView.loadUrl(url);
    }

    // Android 15/17 UIAutomator window hierarchy dumps are unstable in headless
    // runner VMs. Query the actual WebView DOM in this local CI-only app instead.
    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String command = intent.getStringExtra("command");
        if (command == null || webView == null) return;
        if ("snapshot".equals(command)) snapshot();
        else if ("open".equals(command)) {
            Log.i(TAG,"TAP_OPEN_UPI");
            webView.evaluateJavascript("(function(){var a=document.getElementById('openUpi');if(a)a.click()})()",null);
        } else if ("refresh".equals(command)) {
            Log.i(TAG,"TAP_REFRESH_STATUS");
            webView.evaluateJavascript("(function(){var b=document.getElementById('refresh');if(b)b.click()})()",null);
        }
    }

    private void snapshot() {
        if(webView == null) return;
        String js = "(function(){function v(id){var e=document.getElementById(id);return e?e.textContent:'';}" +
            "var a=document.getElementById('openUpi');return JSON.stringify({" +
            "business:v('business'),amount:v('amount'),vpa:v('vpa')," +
            "status:v('status'),href:a?a.getAttribute('href'):''," +
            "pointerEvents:a?a.style.pointerEvents:'',qr:!!document.querySelector('#qr img, #qr canvas')" +
            "});})()";
        webView.evaluateJavascript(js, data -> Log.i(TAG, "CHECKOUT_DOM "+data));
    }

    @Override protected void onDestroy() {
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}
