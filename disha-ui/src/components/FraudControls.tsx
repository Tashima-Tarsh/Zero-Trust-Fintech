import React from 'react';

export const FraudControls: React.FC = () => {
  return (
    <section className="section section-trust" id="trust">
      <div className="content-width">
        <div className="trust-head reveal-on-scroll">
          <div>
            <span className="section-tag">TRUST AND FRAUD-AWARE CONTROLS</span>
            <h2>
              Know More.<br />
              <span>Guess Less.</span>
            </h2>
          </div>
          <p>
            Payments deserve care. DISHA helps businesses organize transaction information and identify signals that may need a closer look.
          </p>
        </div>

        {/* RESTRAINED SECURITY CONSOLE / ILLUSTRATION */}
        <div className="trust-console reveal-on-scroll">
          <div className="trust-console-intro">
            <div className="shield-badge-wrap">
              <div className="restrained-shield-icon" aria-hidden="true">
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M24 4L7 11V22C7 32.5 14.3 42.2 24 45C33.7 42.2 41 32.5 41 22V11L24 4Z" fill="#EAE5FA" stroke="#5B3EA8" strokeWidth="2.5" strokeLinejoin="round"/>
                  <path d="M16 24L22 30L32 18" stroke="#0F9976" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <div>
                <span className="console-mini-label">DETERMINISTIC VERIFICATION</span>
                <h3>Evidence Evaluation Console</h3>
                <p>DISHA inspects technical signals across 7 layers to help you verify payment legitimacy before release.</p>
              </div>
            </div>
            <div className="console-status-pill">
              <span className="status-pulse-dot"></span>
              <span>7 Active Control Signals Monitored</span>
            </div>
          </div>

          <div className="trust-console-telemetry">
            <div className="telemetry-header">
              <span>Live Verification Telemetry</span>
              <span className="telemetry-session">Sample Session #D82_94A2</span>
            </div>
            <div className="telemetry-grid">
              <div className="telemetry-item passed">
                <div className="telemetry-icon">⏱</div>
                <div className="telemetry-details">
                  <strong>Time-Bound Session (15s TTL)</strong>
                  <span>Active challenge window [14.2s remaining]</span>
                </div>
                <span className="telemetry-tag">Passed</span>
              </div>
              <div className="telemetry-item passed">
                <div className="telemetry-icon">⛨</div>
                <div className="telemetry-details">
                  <strong>Duplicate Reference Check</strong>
                  <span>UTR #332198421098 [Unique · 0 Replays]</span>
                </div>
                <span className="telemetry-tag">Passed</span>
              </div>
              <div className="telemetry-item passed">
                <div className="telemetry-icon">◈</div>
                <div className="telemetry-details">
                  <strong>Transaction-Specific Amount</strong>
                  <span>Order ₹1,249.00 + ₹0.37 paise fingerprint</span>
                </div>
                <span className="telemetry-tag">Passed</span>
              </div>
              <div className="telemetry-item passed">
                <div className="telemetry-icon">📋</div>
                <div className="telemetry-details">
                  <strong>Operational Activity Review</strong>
                  <span>Logged in merchant audit trail (20:25:12 IST)</span>
                </div>
                <span className="telemetry-tag">Passed</span>
              </div>
            </div>
          </div>
        </div>

        {/* 7 SUPPORTED FEATURE CARDS */}
        <div className="trust-features-grid">
          <article className="trust-feature-card reveal-on-scroll">
            <div className="feature-card-top">
              <span className="feature-num">01</span>
              <span className="feature-icon purple-tint">⏱</span>
            </div>
            <h3>Time-bound sessions</h3>
            <p>Connect payment activity to a strictly defined session and ephemeral time window (15-second TTL) that expires automatically to prevent stale checkouts.</p>
          </article>

          <article className="trust-feature-card reveal-on-scroll">
            <div className="feature-card-top">
              <span className="feature-num">02</span>
              <span className="feature-icon mint-tint">⛨</span>
            </div>
            <h3>Duplicate reference checks</h3>
            <p>Cross-reference the 12-digit bank UTR against your indexed transaction database in real time to catch and flag repeated reference submissions.</p>
          </article>

          <article className="trust-feature-card reveal-on-scroll">
            <div className="feature-card-top">
              <span className="feature-num">03</span>
              <span className="feature-icon peach-tint">◈</span>
            </div>
            <h3>Transaction-specific amounts</h3>
            <p>Micro-paise fingerprint injection (e.g. ₹0.37) creates mathematically unique checkout amounts, eliminating collisions between simultaneous buyers.</p>
          </article>

          <article className="trust-feature-card reveal-on-scroll">
            <div className="feature-card-top">
              <span className="feature-num">04</span>
              <span className="feature-icon blue-tint">📋</span>
            </div>
            <h3>Operational activity review</h3>
            <p>Comprehensive chronological audit trails log every receipt intake, manual inspection, status update, and operator action with timestamps.</p>
          </article>

          <article className="trust-feature-card reveal-on-scroll">
            <div className="feature-card-top">
              <span className="feature-num">05</span>
              <span className="feature-icon purple-tint">🔍</span>
            </div>
            <h3>Available evidence analysis</h3>
            <p>Multi-factor verification inspecting receipt structure, payer VPA syntax, transaction amounts, and reference formatting against bank standards.</p>
          </article>

          <article className="trust-feature-card reveal-on-scroll">
            <div className="feature-card-top">
              <span className="feature-num">06</span>
              <span className="feature-icon mint-tint">📊</span>
            </div>
            <h3>Transaction records</h3>
            <p>Structured double-entry accounting records with exportable CSV and PDF reports, giving you clean reconciled books for audits and tax filing.</p>
          </article>

          <article className="trust-feature-card reveal-on-scroll feature-span-all">
            <div className="feature-card-top">
              <span className="feature-num">07</span>
              <span className="feature-icon peach-tint">🔐</span>
            </div>
            <h3>Merchant access and configuration controls</h3>
            <p>Granular role-based team permissions, rotated HMAC webhook keys, and configurable alert thresholds managed entirely within your workspace perimeter.</p>
          </article>
        </div>

        {/* HONEST TRUST DISCLOSURE (NO FALSE CLAIMS) */}
        <div className="trust-disclosure-card reveal-on-scroll">
          <div className="disclosure-badge">NOTICE</div>
          <p>
            No software can guarantee the elimination of fraud. Controls and status indicators must be assessed against the actual payment evidence available. DISHA provides transparent technical checks to assist merchant operational review without making unrealistic safety guarantees.
          </p>
        </div>
      </div>
    </section>
  );
};
