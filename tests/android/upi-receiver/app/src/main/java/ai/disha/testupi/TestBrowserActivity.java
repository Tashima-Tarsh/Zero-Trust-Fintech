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
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onConsoleMessage(android.webkit.ConsoleMessage message) {
                Log.i(TAG, "WEBVIEW_CONSOLE "+message.messageLevel()+": "+message.message());
                return true;
            }
        });
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
            Log.i(TAG,"TAP_TOUCH_TO_PAY");
            webView.evaluateJavascript("(function(){var b=document.getElementById('btnOneTouch');if(b)b.click()})()",null);
        } else if ("refresh".equals(command)) {
            Log.i(TAG,"RELOAD_CHECKOUT");
            webView.reload();
        }
    }

    private void snapshot() {
        if(webView == null) return;
        String js = "(function(){" +
            "function v(id){var e=document.getElementById(id);return e?e.textContent:'';}" +
            "function target(el){if(!el)return null;var r=el.getBoundingClientRect();" +
              "return {x:Math.round((r.left+r.width/2)*devicePixelRatio)," +
              "y:Math.round((r.top+r.height/2)*devicePixelRatio)," +
              "visible:r.width>0&&r.height>0&&getComputedStyle(el).display!='none'};}" +
            "var b=document.getElementById('btnOneTouch');" +
            "var app=document.getElementById('app-cred');" +
            "var active=Array.from(document.querySelectorAll('[data-stage]')).find(function(e){return !e.hidden});" +
            "return JSON.stringify({amount:v('payAmount'),stage:active?active.dataset.stage:'none'," +
              "status:v('checkoutStatus'),checking:v('checkingHelp'),receiptUtr:v('receiptUtr')," +
              "disabled:b?b.disabled:true,qr:!!document.querySelector('#paymentQr img, #paymentQr canvas')," +
              "readyState:document.readyState,touchTarget:target(b),appTarget:target(app)});" +
            "})()";
        webView.evaluateJavascript(js, data -> Log.i(TAG, "CHECKOUT_DOM "+data));
    }

    // Mirror a real Android browser host: when the UPI app covers this
    // activity, WebView receives the normal activity visibility lifecycle.
    @Override protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }
    @Override protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override protected void onDestroy() {
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}
