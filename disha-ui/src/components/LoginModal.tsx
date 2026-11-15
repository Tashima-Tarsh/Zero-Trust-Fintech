import React, { useState } from 'react';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (merchant: any) => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email || !password) {
      setError('Please enter your merchant login ID and password.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Invalid merchant credentials.');
        setIsLoading(false);
        return;
      }

      sessionStorage.setItem('disha_token', data.token);
      sessionStorage.setItem('disha_merchant', JSON.stringify(data.merchant));

      if (onSuccess) {
        onSuccess(data.merchant);
      } else {
        window.location.href = data.merchant?.setup_completed ? '/dashboard' : '/setup';
      }
    } catch {
      setError('Unable to connect to authentication server.');
      setIsLoading(false);
    }
  };

  return (
    <div className="modal" style={{ display: 'flex', position: 'fixed', inset: 0, zIndex: 120, alignItems: 'center', justifyContent: 'center' }}>
      <div className="modal-backdrop" onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(18, 11, 40, 0.45)', backdropFilter: 'blur(4px)' }} />
      <div className="modal-content" style={{ position: 'relative', width: '100%', maxWidth: '440px', background: '#ffffff', borderRadius: '24px', padding: '36px', zIndex: 121, boxShadow: '0 20px 50px rgba(45, 25, 95, 0.15)' }}>
        <button type="button" onClick={onClose} style={{ position: 'absolute', top: '20px', right: '20px', border: 'none', background: 'none', cursor: 'pointer', fontSize: '18px', color: '#7a728e' }}>✕</button>
        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          <img src="/assets/disha-symbol-transparent.png" alt="DISHA" width="36" height="36" style={{ marginBottom: '12px' }} />
          <h2 style={{ fontSize: '24px', margin: '0 0 6px', color: '#382477' }}>Welcome Back.</h2>
          <p style={{ fontSize: '13px', color: '#68617b', margin: 0 }}>Your business workspace is ready.</p>
        </div>

        {error && (
          <div className="auth-alert-danger" style={{ marginBottom: '16px' }}>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group" style={{ marginBottom: '16px' }}>
            <label className="form-label" style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '6px' }}>Merchant login ID / email</label>
            <input
              type="text"
              className="form-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. ramesh@kirana.in"
              required
              autoFocus
            />
          </div>

          <div className="form-group" style={{ marginBottom: '20px' }}>
            <label className="form-label" style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '6px' }}>Password</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                className="form-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'none', cursor: 'pointer', color: '#7b7391' }}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <button type="submit" className="btn-auth-submit" disabled={isLoading}>
            {isLoading ? 'Verifying...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
};
