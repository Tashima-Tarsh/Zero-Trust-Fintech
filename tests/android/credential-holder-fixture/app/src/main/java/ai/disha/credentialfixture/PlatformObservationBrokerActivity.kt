package ai.disha.credentialfixture

/** Explicit entry point for platform integration on an independently provisioned image. */
class PlatformObservationBrokerActivity : SessionObservationActivity() {
    override val brokerOnly = true
}
