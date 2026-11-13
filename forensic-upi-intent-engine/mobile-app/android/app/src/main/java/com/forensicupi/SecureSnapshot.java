package com.forensicupi;

import android.app.Activity;
import android.graphics.Bitmap;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.PixelCopy;
import android.view.Window;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

/**
 * Own-app window capture only, following explicit user consent.
 *
 * PixelCopy cannot inspect a different payment application's secure screen.
 * For cross-app MediaProjection, Android prompts the user and protected screens
 * may be unavailable. No covert capture is implemented.
 */
public class SecureSnapshot extends ReactContextBaseJavaModule {
    public SecureSnapshot(ReactApplicationContext context) { super(context); }

    @Override public String getName() { return "SecureSnapshot"; }

    @ReactMethod
    public void captureOwnWindowAfterConsent(boolean userConsented, Promise promise) {
        if (!userConsented) {
            promise.reject("CONSENT_REQUIRED", "Require explicit opt-in in the UI");
            return;
        }
        Activity activity = getCurrentActivity();
        if (activity == null || Build.VERSION.SDK_INT < 26) {
            promise.reject("UNAVAILABLE", "Foreground Activity and Android 8+ required");
            return;
        }
        Window window = activity.getWindow();
        int width = activity.getWindow().getDecorView().getWidth();
        int height = activity.getWindow().getDecorView().getHeight();
        if (width < 1 || height < 1) {
            promise.reject("INVALID_WINDOW", "Window is not laid out");
            return;
        }
        // Avoid retaining or uploading screenshots automatically. A real consent
        // flow must define user review, storage encryption and retention limits.
        Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        PixelCopy.request(window, bitmap, result -> {
            bitmap.recycle();
            if (result == PixelCopy.SUCCESS) {
                promise.resolve("OWN_WINDOW_CAPTURE_DISCARDED_NOT_PAYMENT_PROOF");
            } else {
                promise.reject("COPY_FAILED", "PixelCopy code: " + result);
            }
        }, new Handler(Looper.getMainLooper()));
    }
}
