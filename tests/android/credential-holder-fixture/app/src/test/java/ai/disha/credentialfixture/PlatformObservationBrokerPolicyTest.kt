package ai.disha.credentialfixture

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
}
