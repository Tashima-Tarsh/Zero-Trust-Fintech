// mobile-app/src/components/UnifiedPayTrigger.js
import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Image, Alert } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import UPIIntentBridge from '../services/UPIIntentBridge';
import AppStateTracker from '../sensors/AppStateTracker';

const UnifiedPayTrigger = ({ vpa, amount, session_id, onPaymentComplete }) => {
  const [upiLink, setUpiLink] = useState('');

  useEffect(() => {
    // Generate the NPCI-compliant link
    const link = UPIIntentBridge.generateUPILink(vpa, 'ZeroTrustFintech', amount, session_id);
    setUpiLink(link);
  }, [vpa, amount, session_id]);

  const handleTouchToPay = async () => {
    // 1. Start Forensic Sensors
    AppStateTracker.startTracking();
    
    try {
      // 2. Trigger the Unified Intent
      // This will open the "Complete action using" dialog if multiple apps are installed
      // Or directly open the default UPI app
      await UPIIntentBridge.initiatePayment(upiLink);
      
      // 3. Listen for return (handled in App.js via AppState change)
    } catch (error) {
      Alert.alert('Error', 'No UPI app found. Please install GPay or PhonePe.');
      AppStateTracker.stopTracking();
    }
  };

  return (
    <View style={{ alignItems: 'center', padding: 20 }}>
      <Text style={{ color: '#fff', marginBottom: 10 }}>Touch to Pay ₹{amount}</Text>
      
      {/* The Unified Trigger: Looks like a QR, acts like a Button */}
      <TouchableOpacity 
        activeOpacity={0.7} 
        onPress={handleTouchToPay}
        style={{ borderRadius: 10, overflow: 'hidden', borderWidth: 2, borderColor: '#10b981' }}
      >
        <QRCode
          value={upiLink}
          size={200}
          backgroundColor="white"
          color="#0f172a"
        />
        {/* Overlay to indicate it's clickable */}
        <View style={{ position: 'absolute', bottom: 10, right: 10, backgroundColor: '#10b981', padding: 5, borderRadius: 5 }}>
          <Text style={{ color: 'white', fontSize: 10 }}>TAP TO OPEN UPI</Text>
        </View>
      </TouchableOpacity>

      <Text style={{ color: '#94a3b8', marginTop: 15, fontSize: 12, textAlign: 'center' }}>
        Supports GPay, PhonePe, Paytm, AmazonPay & all NPCI banks
      </Text>
    </View>
  );
};

export default UnifiedPayTrigger;
