// mobile-app/App.js
import React, { useEffect, useRef } from 'react';
import { AppState, View } from 'react-native';
import UnifiedPayTrigger from './src/components/UnifiedPayTrigger';
import AppStateTracker from './src/sensors/AppStateTracker';
import N8NClient from './src/services/N8NClient';

const App = () => {
  const appState = useRef(AppState.currentState);
  const paymentStartTime = useRef(null);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
        // User has returned from UPI App!
        if (paymentStartTime.current) {
          const timeInApp = Date.now() - paymentStartTime.current;
          handleReturnFromUPI(timeInApp);
          paymentStartTime.current = null;
        }
      }
      appState.current = nextAppState;
    });

    return () => subscription.remove();
  }, []);

  const handleReturnFromUPI = async (timeInMs) => {
    // 1. Take Secure Snapshot (Native Module)
    const screenshot = await NativeModules.SecureSnapshot.take();
    
    // 2. Get Telemetry
    const telemetry = AppStateTracker.getData();
    
    // 3. Send to N8N Super Intelligence
    await N8NClient.verifyPayment({
      time_in_app_ms: timeInMs,
      screenshot_base64: screenshot,
      telemetry_data: telemetry,
      // ... other session data
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#0f172a' }}>
      <UnifiedPayTrigger 
        vpa="merchant001@oksbi" 
        amount={499} 
        session_id="SES-123" 
      />
    </View>
  );
};

export default App;
