// mobile-app/src/services/UPIIntentBridge.js
import { Linking, Platform } from 'react-native';

class UPIIntentBridge {
  
  generateUPILink(vpa, name, amount, note) {
    // NPCI Standard Deep Link
    return `upi://pay?pa=${vpa}&pn=${encodeURIComponent(name)}&am=${amount}&tn=${note}&cu=INR`;
  }

  async initiatePayment(link) {
    const startTime = Date.now();
    
    try {
      const supported = await Linking.canOpenURL(link);
      if (supported) {
        await Linking.openURL(link);
        return { success: true, startTime };
      } else {
        // Fallback: If no app opens, show the QR for manual scanning
        return { success: false, error: 'NO_APP' };
      }
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

export default new UPIIntentBridge();
