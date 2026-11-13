import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

export default function PaymentIntentCard({ uri }) {
  const openApp = async () => {
    try { await Linking.openURL(uri); }
    catch { /* QR remains available if the platform cannot handle the scheme. */ }
  };
  return (
    <View style={styles.card}>
      <Text style={styles.label}>UPI payment intent</Text>
      <View style={styles.qr}><QRCode value={uri} size={190} /></View>
      <Pressable style={styles.button} onPress={openApp}>
        <Text style={styles.buttonText}>Open UPI application</Text>
      </Pressable>
      <Text style={styles.notice}>Await independent bank/PSP confirmation. An app return is not a receipt.</Text>
    </View>
  );
}
const styles = StyleSheet.create({
  card: { padding: 24, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', gap: 18 },
  label: { fontWeight: '700', color: '#1a3153', fontSize: 16 },
  qr: { padding: 12, backgroundColor: '#fff', borderRadius: 12 },
  button: { backgroundColor: '#1e49c2', borderRadius: 14, padding: 15, width: '100%' },
  buttonText: { textAlign: 'center', color: '#fff', fontWeight: '700' },
  notice: { textAlign: 'center', color: '#65748b', lineHeight: 20 }
});
