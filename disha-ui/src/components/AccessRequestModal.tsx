import React, { useState } from 'react';

interface AccessRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AccessRequestModal: React.FC<AccessRequestModalProps> = ({ isOpen, onClose }) => {
  const [bizName, setBizName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [category, setCategory] = useState('retail');
  const [volume, setVolume] = useState('500000');
  const [currentCost, setCurrentCost] = useState('8500');
  const [submitted, setSubmitted] = useState(false);

  if (!isOpen) return null;

  const parsedVol = parseFloat(volume) || 0;
  const parsedCost = parseFloat(currentCost) || 0;
  const avoidable = parsedVol * 0.012 + parsedCost;
  const netSavings = Math.max(0, avoidable - 1200);
  const oneTimePrice = netSavings * 4;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!bizName || !email || !phone) return;

    const payload = {
      business_name: bizName,
      email,
      phone,
      category,
      approx_volume: volume,
      current_cost: currentCost,
      submitted_at: new Date().toISOString()
    };
    const prev = JSON.parse(sessionStorage.getItem('disha_access_requests') || '[]');
    prev.push(payload);
    sessionStorage.setItem('disha_access_requests', JSON.stringify(prev));
    setSubmitted(true);
  };

  return (
    <div className="modal" style={{ display: 'flex', position: 'fixed', inset: 0, zIndex: 120, alignItems: 'center', justifyContent: 'center' }}>
      <div className="modal-backdrop" onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(18, 11, 40, 0.45)', backdropFilter: 'blur(4px)' }} />
      <div className="modal-content" style={{ position: 'relative', width: '100%', maxWidth: '520px', background: '#ffffff', borderRadius: '24px', padding: '36px', zIndex: 121, boxShadow: '0 20px 50px rgba(45, 25, 95, 0.15)' }}>
        <button type="button" onClick={onClose} style={{ position: 'absolute', top: '20px', right: '20px', border: 'none', background: 'none', cursor: 'pointer', fontSize: '18px', color: '#7a728e' }}>✕</button>

        {submitted ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: '#d8f7ed', color: '#0b8869', display: 'grid', placeItems: 'center', fontSize: '24px', margin: '0 auto 16px' }}>✓</div>
            <h2 style={{ fontSize: '22px', color: '#382477', margin: '0 0 8px' }}>Access Request Recorded</h2>
            <p style={{ fontSize: '14px', color: '#68617c', lineHeight: 1.6, maxWidth: '400px', margin: '0 auto 20px' }}>
              Your business profile and estimated savings (₹{Math.round(netSavings).toLocaleString('en-IN')}/mo) have been recorded. Your system administrator will review and authorize your instance credentials.
            </p>
            <button type="button" onClick={onClose} className="btn-auth-submit" style={{ maxWidth: '200px', margin: '0 auto' }}>
              Done
            </button>
          </div>
        ) : (
          <div>
            <div style={{ textAlign: 'center', marginBottom: '20px' }}>
              <h2 style={{ fontSize: '24px', margin: '0 0 6px', color: '#382477' }}>Request Merchant Access</h2>
              <p style={{ fontSize: '13px', color: '#68617c', margin: 0 }}>Join businesses running their own payment workspace.</p>
            </div>

            <div style={{ background: '#edf5fe', border: '1px solid #bfdbfe', borderRadius: '10px', padding: '10px 14px', fontSize: '12px', color: '#1e40af', marginBottom: '18px' }}>
              ℹ <strong>Authorized Provisioning:</strong> New DISHA instances are self-hosted and provisioned by your system administrator.
            </div>

            <form onSubmit={handleSubmit}>
              <div className="form-group" style={{ marginBottom: '14px' }}>
                <label className="form-label" style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '4px' }}>Business name *</label>
                <input type="text" className="form-input" value={bizName} onChange={(e) => setBizName(e.target.value)} placeholder="e.g. Zenith Retail" required />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
                <div>
                  <label className="form-label" style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '4px' }}>Contact email *</label>
                  <input type="email" className="form-input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="owner@store.in" required />
                </div>
                <div>
                  <label className="form-label" style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '4px' }}>Contact phone *</label>
                  <input type="tel" className="form-input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit mobile" required />
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: '14px' }}>
                <label className="form-label" style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '4px' }}>Business category</label>
                <select className="form-select" value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="retail">Retail &amp; Counter Stores</option>
                  <option value="ecommerce">E-Commerce &amp; Online</option>
                  <option value="digital">Digital Services</option>
                  <option value="education">Education &amp; Training</option>
                  <option value="services">Professional Services</option>
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
                <div>
                  <label className="form-label" style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '4px' }}>Monthly volume (₹)</label>
                  <input type="number" className="form-input" value={volume} onChange={(e) => setVolume(e.target.value)} />
                </div>
                <div>
                  <label className="form-label" style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '4px' }}>Current costs (₹/mo)</label>
                  <input type="number" className="form-input" value={currentCost} onChange={(e) => setCurrentCost(e.target.value)} />
                </div>
              </div>

              <div style={{ background: '#f5f2fa', padding: '12px 14px', borderRadius: '12px', marginBottom: '18px', display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                <span>Estimated One-Time Price:</span>
                <strong style={{ color: '#382477' }}>₹{Math.round(oneTimePrice).toLocaleString('en-IN')}</strong>
              </div>

              <button type="submit" className="btn-auth-submit">
                Submit Access Request ↗
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};
