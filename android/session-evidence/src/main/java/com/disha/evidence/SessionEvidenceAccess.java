package com.disha.evidence;

import android.content.ComponentName;
import android.content.Context;
import android.provider.Settings;
import android.text.TextUtils;

/** Android OS permission-state helpers for the host checkout application. */
public final class SessionEvidenceAccess {
    private SessionEvidenceAccess() {}

    public static boolean hasNotificationAccess(Context context) {
        String enabled = Settings.Secure.getString(
            context.getContentResolver(), "enabled_notification_listeners");
        if (TextUtils.isEmpty(enabled)) return false;
        ComponentName expected = new ComponentName(
            context, SessionEvidenceNotificationListener.class);
        for (String entry : enabled.split(":")) {
            ComponentName parsed = ComponentName.unflattenFromString(entry);
            if (expected.equals(parsed)) return true;
        }
        return false;
    }
}
