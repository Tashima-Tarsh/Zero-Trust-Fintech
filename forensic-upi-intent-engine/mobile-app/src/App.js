import React, { useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import PaymentIntentCard from './components/PaymentIntentCard';
import { buildUpiIntent } from './services/upi';

export default function App() {
  const [vpa, setVpa] = useState('');
  const [amount, setAmount] = useState('1.00');
  const [note, setNote] = useState('Demo payment');
  let intent = null;
  let error = '';
  try { intent = buildUpiIntent({ vpa, amount, note }); }
  catch (e) { error = e.message; }
  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.page}>
        <Text style={styles.kicker}>FORENSIC UPI ENGINE</Text>
        <Text style={styles.heading}>A safer payment journey.</Text>
        <Text style={styles.intro}>Demo only. Use your own authorized merchant VPA, or render a session from your merchant backend.</Text>
        <View style={styles.form}>
          <Text style={styles.label}>Merchant VPA</Text>
          <TextInput style={styles.input} value={vpa} onChangeText={setVpa} placeholder="merchant@psp" autoCapitalize="none" />
          <Text style={styles.label}>Amount (INR)</Text>
          <TextInput style={styles.input} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
          <Text style={styles.label}>Payment note</Text>
          <TextInput style={styles.input} value={note} onChangeText={setNote} maxLength={100} />
        </View>
        {intent ? <PaymentIntentCard uri={intent} /> : <Text style={styles.error}>{error}</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#eef3fb' },
  page: { padding: 24, gap: 18 },
  kicker: { fontSize: 12, letterSpacing: 2, fontWeight: '800', color: '#1e49c2' },
  heading: { fontSize: 32, fontWeight: '800', color: '#14223d' },
  intro: { color: '#53647d', lineHeight: 22 },
  form: { backgroundColor: '#fff', padding: 20, gap: 10, borderRadius: 20 },
  label: { fontWeight: '700', color: '#2b3f5d' },
  input: { borderWidth: 1, borderColor: '#cbd6e7', borderRadius: 10, padding: 12 },
  error: { color: '#a33a3a' }
});
