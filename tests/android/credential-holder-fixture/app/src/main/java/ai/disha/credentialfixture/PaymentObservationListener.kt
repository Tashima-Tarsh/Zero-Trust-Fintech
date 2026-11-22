package ai.disha.credentialfixture

import android.os.Handler
import android.os.Looper
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/**
 * SessionObservation is main-thread confined. Android service callbacks can
 * arrive on binder threads or during listener teardown; forward every state
 * transition through one ordered main looper instead of racing the coroutine
 * lease and revocation state.
 */
class PaymentObservationListener : NotificationListenerService() {
    private val mainHandler = Handler(Looper.getMainLooper())

    override fun onListenerConnected() {
        mainHandler.post { SessionObservation.listenerConnected = true }
    }

    override fun onListenerDisconnected() {
        mainHandler.post {
            if (SessionObservation.listenerConnected) {
                SessionObservation.listenerConnected = false
                SessionObservation.stop()
            }
        }
    }

    override fun onDestroy() {
        onListenerDisconnected()
        super.onDestroy()
    }

    override fun onNotificationPosted(notification: StatusBarNotification) {
        mainHandler.post {
            if (SessionObservation.listenerConnected) SessionObservation.observe(notification)
        }
    }
}
