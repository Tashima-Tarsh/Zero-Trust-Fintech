package com.sharepay

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Signature
import java.security.spec.ECGenParameterSpec

class DeviceAttestation {
    private val KEYSTORE_PROVIDER = "AndroidKeyStore"
    private val KEY_ALIAS = "sharepay_attestation_key"
    
    /**
     * Generate hardware-backed key pair in Android Keystore (P-256)
     */
    fun generateKeyPair(): String {
        val keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }
        
        if (!keyStore.containsAlias(KEY_ALIAS)) {
            val keyPairGenerator = KeyPairGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_EC, KEYSTORE_PROVIDER
            )
            
            val builder = KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY
            )
                .setDigests(KeyProperties.DIGEST_SHA256)
                .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                .setUserAuthenticationRequired(false)
                .setKeySize(256)
            
            keyPairGenerator.initialize(builder.build())
            keyPairGenerator.generateKeyPair()
        }
        
        // Return public key for server registration
        return getPublicKeyBase64()
    }
    
    /**
     * Get public key in Base64 format for server registration
     */
    fun getPublicKeyBase64(): String {
        val keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }
        val certificate = keyStore.getCertificate(KEY_ALIAS)
            ?: throw IllegalStateException("Key pair not generated yet")
        val publicKey = certificate.publicKey
        return Base64.encodeToString(publicKey.encoded, Base64.NO_WRAP)
    }
    
    /**
     * Sign payload with hardware-backed private key
     */
    fun signPayload(
        utr: String,
        amount: Double,
        timestamp: Long,
        nonce: String,
        challengeId: String
    ): String {
        val keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }
        val privateKey = keyStore.getKey(KEY_ALIAS, null) as java.security.PrivateKey
        
        // Create deterministic message
        val message = "$utr|$amount|$timestamp|$nonce|$challengeId"
        
        // Sign with SHA256withECDSA
        val signature = Signature.getInstance("SHA256withECDSA")
        signature.initSign(privateKey)
        signature.update(message.toByteArray(Charsets.UTF_8))
        
        return Base64.encodeToString(signature.sign(), Base64.NO_WRAP)
    }
    
    /**
     * Get device ID (unique per installation)
     */
    fun getDeviceId(): String {
        return java.util.UUID.randomUUID().toString()
    }
}
