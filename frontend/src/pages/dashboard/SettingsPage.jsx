/**
 * SettingsPage.jsx
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Bell, Moon, Sun, Shield, LogOut, Trash2, Check } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth.jsx';
import { useStore } from '../../store/store.js';
import { updateProfile, updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { auth } from '../../lib/firebase.js';

function Section({ title, children }) {
  return (
    <div className="data-card flex flex-col gap-5">
      <h2 className="font-equinox text-white/50 text-xs tracking-[0.15em]">{title}</h2>
      {children}
    </div>
  );
}

function Toggle({ label, sub, checked, onChange }) {
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <p className="text-white/70 text-sm">{label}</p>
        {sub && <p className="text-white/30 text-xs mt-0.5">{sub}</p>}
      </div>
      <button
        onClick={() => onChange(!checked)}
        className="relative w-10 h-5 rounded-full transition-all duration-200 shrink-0"
        style={{ background: checked ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.1)' }}
        role="switch"
        aria-checked={checked}
      >
        <span
          className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-200"
          style={{ transform: checked ? 'translateX(20px)' : 'translateX(0)' }}
        />
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useStore();
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [nameSaving,  setNameSaving]  = useState(false);
  const [nameSaved,   setNameSaved]   = useState(false);

  const [notifs, setNotifs] = useState({
    expiryAlerts: true,
    riskAlerts:   true,
    fraudAlerts:  true,
    weeklyDigest: false,
  });

  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [pwError,   setPwError]   = useState('');
  const [pwSaving,  setPwSaving]  = useState(false);
  const [pwSaved,   setPwSaved]   = useState(false);

  const handleSaveName = async () => {
    if (!displayName.trim()) return;
    setNameSaving(true);
    try {
      await updateProfile(auth.currentUser, { displayName: displayName.trim() });
      setNameSaved(true);
      setTimeout(() => setNameSaved(false), 2000);
    } catch (e) { console.error(e); }
    setNameSaving(false);
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPwError('');
    if (pwForm.next !== pwForm.confirm) { setPwError('Passwords do not match.'); return; }
    if (pwForm.next.length < 8) { setPwError('Password must be at least 8 characters.'); return; }
    setPwSaving(true);
    try {
      const cred = EmailAuthProvider.credential(auth.currentUser.email, pwForm.current);
      await reauthenticateWithCredential(auth.currentUser, cred);
      await updatePassword(auth.currentUser, pwForm.next);
      setPwSaved(true);
      setPwForm({ current: '', next: '', confirm: '' });
      setTimeout(() => setPwSaved(false), 2000);
    } catch (err) {
      setPwError(err.code === 'auth/wrong-password' ? 'Current password is incorrect.' : 'Failed to update password.');
    }
    setPwSaving(false);
  };

  const handleLogout = async () => { await logout(); navigate('/login', { replace: true }); };

  return (
    <div className="p-6 lg:p-8 max-w-2xl mx-auto page-enter">
      <div className="mb-8">
        <h1 className="font-equinox text-white mb-1" style={{ fontSize: '1.8rem', letterSpacing: '0.04em' }}>Settings</h1>
        <p className="text-white/35 text-sm">Account preferences and configuration.</p>
      </div>

      <div className="flex flex-col gap-4">
        {/* Profile */}
        <Section title="PROFILE">
          <div className="flex items-center gap-4">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-medium"
              style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}
            >
              {(user?.displayName || user?.email || 'U')[0].toUpperCase()}
            </div>
            <div>
              <p className="text-white/70 text-sm font-medium">{user?.displayName || 'No name set'}</p>
              <p className="text-white/30 text-xs">{user?.email}</p>
            </div>
          </div>

          <div className="flex gap-3">
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Display name"
              className="input-field flex-1"
            />
            <button onClick={handleSaveName} disabled={nameSaving} className="btn-primary px-5 text-xs">
              {nameSaved ? <Check size={14} /> : nameSaving ? <div className="w-3 h-3 border border-black/20 border-t-black/60 rounded-full animate-spin" /> : 'Save'}
            </button>
          </div>
        </Section>

        {/* Appearance */}
        <Section title="APPEARANCE">
          <Toggle
            label="Dark mode"
            sub="Default dark. Toggle for light mode."
            checked={theme === 'dark'}
            onChange={toggleTheme}
          />
        </Section>

        {/* Notifications */}
        <Section title="NOTIFICATIONS">
          {[
            { key: 'expiryAlerts',  label: 'Warranty expiry alerts',  sub: 'Alerts when products expire within 30 days' },
            { key: 'riskAlerts',    label: 'High risk alerts',         sub: 'Notify when risk score exceeds 65' },
            { key: 'fraudAlerts',   label: 'Fraud detection alerts',   sub: 'Alert when an invoice is flagged' },
            { key: 'weeklyDigest',  label: 'Weekly digest',            sub: 'Summary of your warranty portfolio every Monday' },
          ].map(({ key, label, sub }) => (
            <Toggle
              key={key}
              label={label}
              sub={sub}
              checked={notifs[key]}
              onChange={(v) => setNotifs((n) => ({ ...n, [key]: v }))}
            />
          ))}
        </Section>

        {/* Security */}
        <Section title="SECURITY">
          <p className="text-white/35 text-xs -mt-2">Change your password. You'll need to enter your current password to confirm.</p>
          <form onSubmit={handleChangePassword} className="flex flex-col gap-3">
            {['current', 'next', 'confirm'].map((field) => (
              <input
                key={field}
                type="password"
                value={pwForm[field]}
                onChange={(e) => setPwForm((p) => ({ ...p, [field]: e.target.value }))}
                placeholder={{ current: 'Current password', next: 'New password', confirm: 'Confirm new password' }[field]}
                className="input-field"
                autoComplete={field === 'current' ? 'current-password' : 'new-password'}
              />
            ))}
            {pwError && (
              <p className="text-xs px-3 py-2 rounded-[6px]" style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.08)' }}>
                {pwError}
              </p>
            )}
            <button type="submit" disabled={pwSaving} className="btn-primary text-xs self-start">
              {pwSaved ? <><Check size={13} /> Updated</> : pwSaving ? <div className="w-3 h-3 border border-black/20 border-t-black/60 rounded-full animate-spin" /> : 'Update password'}
            </button>
          </form>
        </Section>

        {/* Account */}
        <Section title="ACCOUNT">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 text-white/40 text-sm hover:text-white/70 transition-colors"
          >
            <LogOut size={15} /> Sign out of all sessions
          </button>
          <div className="h-px" style={{ background: 'rgba(255,255,255,0.05)' }} />
          <button className="flex items-center gap-3 text-white/25 text-sm hover:text-white/50 transition-colors">
            <Trash2 size={15} /> Delete account and all data
          </button>
        </Section>
      </div>
    </div>
  );
}
