import React from 'react';
import { Text, View } from 'react-native';

/** Always render authenticated merchant status, never infer from a PSP app return. */
export default function PaymentStatusBadge({ serverStatus = 'PENDING' }) {
  const text = ({
    PAID: 'Bank-confirmed payment',
    REVIEW: 'Needs reconciliation',
    EXPIRED: 'Session expired',
    PENDING: 'Awaiting bank confirmation'
  })[serverStatus] || 'Status unavailable';
  return (
    <View accessibilityRole="text" style={{ padding: 12, borderRadius: 12, backgroundColor: '#eef3fb' }}>
      <Text style={{ color: '#203c69', fontWeight: '700' }}>{text}</Text>
    </View>
  );
}
