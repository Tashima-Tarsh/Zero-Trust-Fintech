package ai.disha.testupi;

import android.app.Activity;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceError;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.content.Intent;
import android.net.Uri;
import android.util.Log;
import android.widget.TextView;
import android.view.ViewGroup;

public final class TestBrowserActivity extends Activity {
    private static final String TAG = "DISHA_UPI_TEST";
    private static final int UPI_EVIDENCE_REQUEST = 8202;
    private long lastIntentLaunchMs = 0L;
    private WebView webView;
    // Sample the DOM directly: ActivityManager -W is not a safe polling API in CI.
    private final Handler snapshotHandler = new Handler(Looper.getMainLooper());
    private final Runnable periodicSnapshot = new Runnable() {
        @Override public void run() {
            if (webView != null) {
                snapshot();
                snapshotHandler.postDelayed(this, 1200);
            }
        }
    };

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        webView = new WebView(this);
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("upi".equalsIgnoreCase(uri.getScheme()) && "pay".equalsIgnoreCase(uri.getHost())) {
                    Log.i(TAG, "ANDROID_WEBVIEW_DISPATCH upi://pay");
                    // Android evidence is collected for launch/return only.
                    // Never treat an app-reported RESULT_OK as bank settlement.
                    try {
                        Intent paymentIntent = new Intent(Intent.ACTION_VIEW, uri);
                        lastIntentLaunchMs = SystemClock.elapsedRealtime();
                        Log.i(TAG, "ANDROID_INTENT_REQUESTED protocol=upi handler=external");
                        startActivityForResult(paymentIntent, UPI_EVIDENCE_REQUEST);
                        Log.i(TAG, "ANDROID_INTENT_DISPATCHED request=" + UPI_EVIDENCE_REQUEST);
                    } catch (android.content.ActivityNotFoundException missing) {
                        Log.e(TAG, "ANDROID_INTENT_NO_HANDLER result=UNAVAILABLE");
                    } catch (SecurityException blocked) {
                        Log.e(TAG, "ANDROID_INTENT_SECURITY_BLOCK result=UNAVAILABLE");
                    } catch (Exception unexpected) {
                        Log.e(TAG, "ANDROID_INTENT_LAUNCH_EXCEPTION class=" +
                            unexpected.getClass().getSimpleName());
                    }
                    return true;
                }
                return false;
            }
            @Override public void onPageFinished(WebView view, String url) {
                Uri page = Uri.parse(url);
                // Never write bearer query parameters to public CI artifacts.
                Log.i(TAG, "WEBVIEW_PAGE_FINISHED " + page.getPath());
                snapshot();
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request,
                    WebResourceError error) {
                if (request.isForMainFrame()) {
                    Log.e(TAG, "WEBVIEW_MAINFRAME_ERROR " + error.getErrorCode()
                        + " " + error.getDescription());
                }
            }
            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                Log.e(TAG, "WEBVIEW_RENDER_PROCESS_GONE crashed=" + detail.didCrash());
                snapshotHandler.removeCallbacks(periodicSnapshot);
                webView = null;
                view.destroy();
                finish();
                return true;
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
        String token = Uri.parse(url).getQueryParameter("token");
        if (token == null || token.length() != 48) {
            Log.e(TAG, "CHECKOUT_FIXTURE_TOKEN_MISSING");
            TextView blocked = new TextView(this);
            blocked.setText("INVALID TEST CHECKOUT TOKEN");
            setContentView(blocked);
            return;
        }
        Log.i(TAG,"OPEN_CHECKOUT_FIXTURE_TOKEN_PRESENT");
        webView.loadUrl(url);
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent response) {
        super.onActivityResult(requestCode, resultCode, response);
        if (requestCode != UPI_EVIDENCE_REQUEST) return;
        long elapsed = lastIntentLaunchMs <= 0 ? -1
            : SystemClock.elapsedRealtime() - lastIntentLaunchMs;
        String label = resultCode == Activity.RESULT_OK ? "APP_REPORTED_OK"
            : resultCode == Activity.RESULT_CANCELED ? "CANCELLED" : "OTHER";
        // Status is an *untrusted* string supplied by the target Android app.
        String raw = response == null ? null : response.getStringExtra("Status");
        String declared = raw != null && raw.equalsIgnoreCase("SUCCESS") ? "SUCCESS"
            : raw != null && raw.equalsIgnoreCase("FAILURE") ? "FAILURE" : "UNAVAILABLE";
        Log.i(TAG, "ANDROID_ACTIVITY_RESULT classification=" + label
            + " appReported=" + declared + " elapsedMs=" + elapsed + " bankVerified=false");
        lastIntentLaunchMs = 0L;
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
            Log.i(TAG,"TAP_QR_TO_OPEN_UPI");
            webView.evaluateJavascript("(function(){var b=document.getElementById('qrTapToPay');if(b)b.click()})()",null);
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
            "var b=null;" +
            "var app=null;" +
            "var qrTap=document.getElementById('qrTapToPay');" +
            "var active=Array.from(document.querySelectorAll('[data-stage]')).find(function(e){return !e.hidden});" +
            "return JSON.stringify({amount:v('payAmount'),stage:active?active.dataset.stage:'none'," +
              "status:v('checkoutStatus'),paymentKind:v('paymentKind'),checking:v('checkingHelp'),receiptUtr:v('receiptUtr')," +
              "disabled:b?b.disabled:true,qr:!!document.querySelector('#paymentQr img, #paymentQr canvas')," +
              "readyState:document.readyState,qrHref:qrTap?qrTap.getAttribute('href'):'',qrTarget:target(qrTap),qrDisabled:!qrTap||qrTap.getAttribute('aria-disabled')==='true',touchTarget:target(b),appTarget:target(app)});" +
            "})()";
        webView.evaluateJavascript(js, data -> Log.i(TAG, "CHECKOUT_DOM "+data));
    }

    // Mirror a real Android browser host: when the UPI app covers this
    // activity, WebView receives the normal activity visibility lifecycle.
    @Override protected void onPause() {
        snapshotHandler.removeCallbacks(periodicSnapshot);
        if (webView != null) webView.onPause();
        Log.i(TAG,"ANDROID_HOST_PAUSED");
        super.onPause();
    }
    @Override protected void onResume() {
        super.onResume();
        Log.i(TAG,"ANDROID_HOST_RESUMED bankVerified=false");
        if (webView != null) {
            webView.onResume();
            snapshotHandler.removeCallbacks(periodicSnapshot);
            snapshotHandler.post(periodicSnapshot);
        }
    }

    @Override protected void onDestroy() {
        snapshotHandler.removeCallbacks(periodicSnapshot);
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
