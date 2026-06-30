/**
 * RegisterPage.jsx
 */
import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { gsap } from 'gsap';
import { Eye, EyeOff, Mail, Lock, User, ArrowRight, Chrome, Check } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth.jsx';

function FirebaseErrorMessage(code) {
  const map = {
    'auth/email-already-in-use':  'An account with this email already exists.',
    'auth/invalid-email':         'Please enter a valid email address.',
    'auth/weak-password':         'Password is too weak. Use at least 8 characters.',
    'auth/network-request-failed':'Network error. Check your connection.',
    'auth/popup-closed-by-user':  '',
  };
  return map[code] || 'An error occurred. Please try again.';
}

const PASSWORD_RULES = [
  { label: 'At least 8 characters', test: (p) => p.length >= 8 },
  { label: 'Contains a number',      test: (p) => /\d/.test(p) },
  { label: 'Contains a letter',      test: (p) => /[a-zA-Z]/.test(p) },
];

export default function RegisterPage() {
  const { register, loginWithGoogle, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [name,     setName]     = useState('');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPwd,  setShowPwd]  = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error,    setError]    = useState('');
  const [success,  setSuccess]  = useState(false);

  const containerRef = useRef(null);

  useEffect(() => {
    if (isAuthenticated) { navigate('/dashboard', { replace: true }); return; }
    gsap.set(containerRef.current, { opacity: 0, y: 24 });
    gsap.to(containerRef.current, { opacity: 1, y: 0, duration: 0.7, ease: 'power2.out', delay: 0.1 });
  }, [isAuthenticated]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name || !email || !password) { setError('Please fill in all fields.'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    setError('');
    setLoading(true);
    try {
      await register(email, password, name);
      setSuccess(true);
    } catch (err) {
      setError(FirebaseErrorMessage(err.code) || err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setError('');
    setGoogleLoading(true);
    try {
      await loginWithGoogle();
      navigate('/dashboard', { replace: true });
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user') setError(FirebaseErrorMessage(err.code));
    } finally {
      setGoogleLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6" style={{ background: '#000' }}>
        <div className="text-center max-w-sm">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-8"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}
          >
            <Check size={22} className="text-white/70" />
          </div>
          <h2 className="font-equinox text-white text-2xl mb-3" style={{ letterSpacing: '0.04em' }}>
            Check your email
          </h2>
          <p className="text-white/40 text-sm mb-8 leading-relaxed">
            We sent a verification link to <span className="text-white/70">{email}</span>.
            Click it to activate your account, then sign in.
          </p>
          <Link to="/login" className="btn-primary text-sm">
            Go to sign in <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex" style={{ background: '#000' }}>
      {/* Left panel */}
      <div
        className="hidden lg:flex flex-col justify-between p-16 w-2/5"
        style={{ borderRight: '1px solid rgba(255,255,255,0.05)' }}
      >
        <Link to="/" className="font-equinox text-xs tracking-[0.25em] text-white/60">
          WARRANTY VAULT
        </Link>
        <div>
          <p className="text-white/20 text-xs font-mono tracking-[0.15em] uppercase mb-4">
            Free forever
          </p>
          <h2
            className="font-equinox text-white leading-none"
            style={{ fontSize: '3.5rem', letterSpacing: '0.02em' }}
          >
            Start tracking.<br />
            <span className="text-white/35">No cost.</span>
          </h2>
          <p className="text-white/25 text-sm mt-6 max-w-xs leading-relaxed">
            Upload invoices, get instant AI analysis, track every warranty.
            Zero cost, local-first intelligence.
          </p>
        </div>
        <p className="text-white/20 text-xs font-mono">v2.0 · Firebase Hosting · Free tier</p>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center px-6 py-16">
        <div ref={containerRef} className="w-full max-w-[380px]">
          <Link to="/" className="lg:hidden block font-equinox text-xs tracking-[0.25em] text-white/60 mb-12">
            WARRANTY VAULT
          </Link>

          <div className="mb-10">
            <h1 className="font-equinox text-white mb-2" style={{ fontSize: '2rem', letterSpacing: '0.04em' }}>
              Create account
            </h1>
            <p className="text-white/35 text-sm">Free to use. No credit card required.</p>
          </div>

          {/* Google */}
          <button
            onClick={handleGoogle}
            disabled={googleLoading || loading}
            className="w-full flex items-center justify-center gap-3 py-3 mb-6 rounded-md text-sm font-medium"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: 'rgba(255,255,255,0.7)',
              transition: 'background 200ms, border-color 200ms',
              cursor: (googleLoading || loading) ? 'not-allowed' : 'pointer',
            }}
            onMouseEnter={(e) => { if (!googleLoading && !loading) { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.17)'; } }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }}
          >
            {googleLoading
              ? <div className="w-4 h-4 border border-white/20 border-t-white/60 rounded-full animate-spin" />
              : <Chrome size={16} />}
            Continue with Google
          </button>

          <div className="flex items-center gap-4 mb-6">
            <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.07)' }} />
            <span className="text-white/20 text-xs font-mono">or</span>
            <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.07)' }} />
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* Name */}
            <div className="relative">
              <User size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/25" />
              <input
                type="text"
                placeholder="Full name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input-field pl-11"
                autoComplete="name"
                autoFocus
              />
            </div>

            {/* Email */}
            <div className="relative">
              <Mail size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/25" />
              <input
                type="email"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-field pl-11"
                autoComplete="email"
              />
            </div>

            {/* Password */}
            <div>
              <div className="relative">
                <Lock size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/25" />
                <input
                  type={showPwd ? 'text' : 'password'}
                  placeholder="Password (min 8 chars)"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input-field pl-11 pr-11"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-white/25 hover:text-white/50 transition-colors"
                >
                  {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>

              {/* Password strength */}
              {password.length > 0 && (
                <div className="flex flex-col gap-1.5 mt-3">
                  {PASSWORD_RULES.map(({ label, test }) => (
                    <div key={label} className="flex items-center gap-2">
                      <div
                        className="w-1 h-1 rounded-full"
                        style={{ background: test(password) ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.15)' }}
                      />
                      <span
                        className="text-xs"
                        style={{ color: test(password) ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.2)' }}
                      >
                        {label}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {error && (
              <p className="text-xs px-4 py-3 rounded-md" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)' }}>
                {error}
              </p>
            )}

            <button type="submit" disabled={loading || googleLoading} className="btn-primary w-full mt-2">
              {loading
                ? <div className="w-4 h-4 border border-black/20 border-t-black/60 rounded-full animate-spin" />
                : <>Create account <ArrowRight size={14} /></>}
            </button>
          </form>

          <p className="text-center mt-8 text-xs text-white/25">
            Already have an account?{' '}
            <Link to="/login" className="text-white/50 hover:text-white/80 transition-colors">Sign in →</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
