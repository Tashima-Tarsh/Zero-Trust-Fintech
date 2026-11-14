package com.sharepay

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

class PaymentRepository(
    private val baseUrl: String = "http://10.0.2.2:8000/api/v1"
) {
    private val deviceAttestation = DeviceAttestation()
    
    /**
     * Register hardware-backed public key with backend
     */
    suspend fun registerDevice(): Boolean = withContext(Dispatchers.IO) {
        try {
            val publicKey = deviceAttestation.generateKeyPair()
            val deviceId = deviceAttestation.getDeviceId()
            
            val json = JSONObject().apply {
                put("device_id", deviceId)
                put("public_key", publicKey)
                put("algorithm", "ecdsa")
            }
            
            val url = URL("$baseUrl/device/register")
            val connection = url.openConnection() as HttpURLConnection
            connection.requestMethod = "POST"
            connection.setRequestProperty("Content-Type", "application/json")
            connection.doOutput = true
            
            connection.outputStream.use {
                it.write(json.toString().toByteArray())
            }
            
            val responseCode = connection.responseCode
            Log.d("PaymentRepo", "Device registration status: $responseCode")
            
            return@withContext responseCode in 200..299
        } catch (e: Exception) {
            Log.e("PaymentRepo", "Device registration failed", e)
            false
        }
    }
    
    /**
     * Request dynamic payment challenge
     */
    suspend fun requestChallenge(merchantId: String, amount: Double): String? = withContext(Dispatchers.IO) {
        try {
            val json = JSONObject().apply {
                put("merchant_id", merchantId)
                put("amount", amount)
            }
            
            val url = URL("$baseUrl/challenge/generate")
            val connection = url.openConnection() as HttpURLConnection
            connection.requestMethod = "POST"
            connection.setRequestProperty("Content-Type", "application/json")
            connection.doOutput = true
            
            connection.outputStream.use {
                it.write(json.toString().toByteArray())
            }
            
            if (connection.responseCode in 200..299) {
                val response = connection.inputStream.bufferedReader().readText()
                val jsonResponse = JSONObject(response)
                return@withContext jsonResponse.optString("challenge_id", null)
            } else {
                Log.e("PaymentRepo", "Challenge generation error: HTTP ${connection.responseCode}")
                null
            }
        } catch (e: Exception) {
            Log.e("PaymentRepo", "Challenge request failed", e)
            null
        }
    }
    
    /**
     * Submit payment with cryptographic device attestation
     */
    suspend fun submitPayment(
        utr: String,
        amount: Double,
        merchantId: String,
        challengeId: String,
        challengeSecret: String = ""
    ): Boolean = withContext(Dispatchers.IO) {
        try {
            val timestamp = System.currentTimeMillis() / 1000
            val nonce = java.util.UUID.randomUUID().toString()
            val deviceId = deviceAttestation.getDeviceId()
            
            // Hardware-backed signing
            val signature = deviceAttestation.signPayload(
                utr, amount, timestamp, nonce, challengeId
            )
            
            val challengeResponse = computeChallengeResponse(challengeId, merchantId, challengeSecret)
            
            val json = JSONObject().apply {
                put("utr", utr)
                put("amount", amount)
                put("timestamp", timestamp)
                put("nonce", nonce)
                put("device_id", deviceId)
                put("signature", signature)
                put("algorithm", "ecdsa")
                put("challenge_id", challengeId)
                put("challenge_response", challengeResponse)
                put("merchant_id", merchantId)
                put("source_type", "native_share")
                put("ip_address", "127.0.0.1")
                put("user_agent", "SharePay-Android/1.0")
            }
            
            val url = URL("$baseUrl/payment/verify")
            val connection = url.openConnection() as HttpURLConnection
            connection.requestMethod = "POST"
            connection.setRequestProperty("Content-Type", "application/json")
            connection.doOutput = true
            
            connection.outputStream.use {
                it.write(json.toString().toByteArray())
            }
            
            val responseCode = connection.responseCode
            Log.d("PaymentRepo", "Payment verification status: $responseCode")
            
            return@withContext responseCode in 200..299
        } catch (e: Exception) {
            Log.e("PaymentRepo", "Payment submission failed", e)
            false
        }
    }
    
    private fun computeChallengeResponse(challengeId: String, merchantId: String, secret: String): String {
        val input = "$challengeId|$merchantId|$secret"
        val bytes = MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.UTF_8))
        return bytes.joinToString("") { "%02x".format(it) }
    }
}
