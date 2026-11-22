# Android observer App Link (test image only)

The observer accepts only `https://disha8-2.thenitishkr.in/android/observer/<43-character-ticket>`.
The ticket is issued by the existing checkout pairing endpoint, lasts at most 60 seconds, is redeemed exactly once, and is exchanged for a scoped observer capability rather than the checkout bearer.

`public/.well-known/assetlinks.json` names the SHA-256 certificate fingerprint observed when Railway built the Android lab deployment at commit `82b0986`. It is a **test-image signing identity only**. It is not a final AOSP, OEM, Play, or production release certificate.

Before an image-preinstalled broker is released, replace that entry only with the independently verified certificate fingerprint from that image's signing pipeline, then verify the served JSON from the final HTTPS origin. Do not add speculative certificates or relax the broker's original-system-install check.

The HTTPS fallback page intentionally does not redeem the ticket, expose checkout data, load external content, or send a referrer. A non-verified browser therefore cannot turn an App Link visit into a payment or evidence submission.

On the original image-installed broker, open a DISHA checkout link and use **Show observer public key fingerprint** during OEM provisioning. This initializes the same Android Keystore signing key used for evidence. An authorized OEM operator must independently verify the device and its image before registering the displayed SHA-256 SPKI fingerprint in `DISHA_UDEB_PINNED_DEVICE_KEY_SHA256`. The App Link signing certificate and the device key fingerprint serve different purposes. Provisioning does not grant notification access, redeem the ticket, or start observation.
