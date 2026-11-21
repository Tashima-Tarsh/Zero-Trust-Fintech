package ai.disha.credentialfixture

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

class PaymentObservationListener : NotificationListenerService() {
    override fun onListenerConnected() {
        SessionObservation.listenerConnected = true
    }

    override fun onListenerDisconnected() {
        if (SessionObservation.listenerConnected) {
            SessionObservation.listenerConnected = false
            SessionObservation.stop()
        }
    }

    override fun onDestroy() {
        onListenerDisconnected()
        super.onDestroy()
    }

    override fun onNotificationPosted(notification: StatusBarNotification) {
        SessionObservation.observe(notification)
    }
}
