package ai.disha.credentialfixture

import java.security.KeyFactory
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PlatformObservationBrokerPolicyTest {
    private val token = "a".repeat(43)
    private val link = "https://disha8-2.thenitishkr.in/android/observer/$token"
    private val view = "android.intent.action.VIEW"

    @Test fun acceptsOriginalSystemAppAndExactLink() {
        assertEquals(token, PlatformObservationBrokerPolicy.ticket(view, link, true, false))
    }

    @Test fun rejectsRuntimeAndUpdatedSystemInstallations() {
        assertNull(PlatformObservationBrokerPolicy.ticket(view, link, false, false))
        assertNull(PlatformObservationBrokerPolicy.ticket(view, link, true, true))
    }

    @Test fun rejectsWrongActionsAndNoncanonicalLinks() {
        assertNull(PlatformObservationBrokerPolicy.ticket("android.intent.action.MAIN", link, true, false))
        for (invalid in listOf(link + "?extra=1", link + "#fragment", link + "/",
            link.replace("https:", "http:"), link.replace(".in/", ".in.example/"),
            link.replace(token, token.dropLast(1)))) {
            assertNull(PlatformObservationBrokerPolicy.ticket(view, invalid, true, false))
        }
    }

    @Test fun neverAcceptsCustomSchemeFallback() {
        assertNull(PlatformObservationBrokerPolicy.ticket(
            view, "disha-observe://pair/$token", true, false
        ))
    }

    @Test fun fingerprintsTheSameSpkiBytesAsTheServer() {
        val spki = Base64.getDecoder().decode(
            "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEL4ZiwtKNy439q+aviWxHtQB9ycPLXhq1oLaTzt7QXXnIrcqtDHa+kA0L42WPAxpktpw4RYKodJp73EeAsO3DtA=="
        )
        val key = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(spki))
        assertEquals("5adae3d84b27972a06faddf9396ccf6a4955397ef7f99219ee7891c83b043d30",
            PlatformObservationBrokerPolicy.publicKeyFingerprint(key))
    }
}
