package com.forensicupi;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.os.SystemClock;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.LifecycleEventListener;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import java.security.MessageDigest;
import java.util.Locale;

/**
 * UPI intent handoff, elapsed-time measurement, and installed APK signer introspection.
 * An intent return or package digest never proves a payment completed.
 */
public class UPIIntentBridge extends ReactContextBaseJavaModule implements LifecycleEventListener {
    private final ReactApplicationContext reactContext;
    private long startedAtMs = 0L;
    private boolean activityPaused = false;

    public UPIIntentBridge(ReactApplicationContext context) {
        super(context);
        reactContext = context;
        context.addLifecycleEventListener(this);
    }

    @Override public String getName() { return "UPIIntentBridge"; }

    @ReactMethod
    public void openUpi(String intentUri, Promise promise) {
        try {
            Uri uri = Uri.parse(intentUri);
            if (!"upi".equalsIgnoreCase(uri.getScheme()) ||
                    !"pay".equalsIgnoreCase(uri.getHost()) ||
                    uri.getQueryParameter("pa") == null ||
                    uri.getQueryParameter("am") == null) {
                promise.reject("INVALID_URI", "Expected upi://pay with a payee and amount");
                return;
            }
            Activity activity = getCurrentActivity();
            if (activity == null) {
                promise.reject("NO_ACTIVITY", "No foreground Activity");
                return;
            }
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            // Android chooses the handler; cannot reliably identify the final PSP
            // when a chooser, redirect, or third-party handoff is involved.
            activity.startActivity(intent);
            startedAtMs = SystemClock.elapsedRealtime();
            activityPaused = false;
            promise.resolve("UPI_INTENT_OPENED_NOT_PAYMENT_VERIFIED");
        } catch (Exception exception) {
            promise.reject("INTENT_FAILED", exception);
        }
    }

    @Override
    public void onHostResume() {
        if (startedAtMs > 0L && activityPaused) {
            long elapsedMs = Math.max(0L, SystemClock.elapsedRealtime() - startedAtMs);
            WritableMap event = Arguments.createMap();
            event.putDouble("elapsed_ms", (double) elapsedMs);
            event.putBoolean("can_confirm_payment", false);
            reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                    .emit("upiIntentReturn", event);
            startedAtMs = 0L;
            activityPaused = false;
        }
    }

    @Override public void onHostPause() { activityPaused = true; }
    @Override public void onHostDestroy() {
        startedAtMs = 0L;
        activityPaused = false;
    }

    @ReactMethod
    public void getInstalledPackageSignerSha256(String packageName, Promise promise) {
        // Introspection is optional and not evidence that the *selected* UPI app was used.
        // Android 11+ package visibility restrictions may hide installed apps.
        if (!packageName.matches("[a-zA-Z0-9_.]{3,255}")) {
            promise.reject("PACKAGE_INVALID", "Invalid package name");
            return;
        }
        try {
            PackageManager pm = reactContext.getPackageManager();
            Signature[] signatures;
            if (Build.VERSION.SDK_INT >= 28) {
                PackageInfo info = pm.getPackageInfo(packageName, PackageManager.GET_SIGNING_CERTIFICATES);
                if (info.signingInfo == null) {
                    promise.reject("NOT_SIGNED", "No signing identity available");
                    return;
                }
                signatures = info.signingInfo.hasMultipleSigners()
                        ? info.signingInfo.getApkContentsSigners()
                        : info.signingInfo.getSigningCertificateHistory();
            } else {
                PackageInfo info = pm.getPackageInfo(packageName, PackageManager.GET_SIGNATURES);
                signatures = info.signatures;
            }
            if (signatures == null || signatures.length == 0) {
                promise.reject("NOT_SIGNED", "No signatures found");
                return;
            }
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hashed = digest.digest(signatures[0].toByteArray());
            StringBuilder hex = new StringBuilder();
            for (byte b : hashed) hex.append(String.format(Locale.US, "%02x", b & 0xff));
            WritableMap details = Arguments.createMap();
            details.putString("package_name", packageName);
            details.putString("reported_cert_sha256", hex.toString());
            details.putBoolean("proof_of_payment", false);
            promise.resolve(details);
        } catch (Exception exception) {
            promise.reject("INSPECTION_UNAVAILABLE", exception);
        }
    }
}
