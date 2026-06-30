import React, { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { gsap } from 'gsap';
import { Mail, ArrowLeft, Check } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth.jsx';

export default function ForgotPasswordPage() {
  const { resetPassword } = useAuth();
  const [email,   setEmail]   = useState('');
  const [loading, setLoading] = useState(false);
  const [sent,    setSent]    = useState(false);
  const [error,   setError]   = useState('');
  const ref = useRef(null);

  useEffect(() => {
    gsap.set(ref.current, { opacity: 0, y: 20 });
    gsap.to(ref.current, { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out', delay: 0.1 });
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email) { setError('Enter your email address.'); return; }
    setError(''); setLoading(true);
    try {
      await resetPassword(email);
      setSent(true);
    } catch (err) {
      setError(err.code === 'auth/user-not-found'
        ? 'No account found with this email.'
        : 'Unable to send reset email. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ background: '#000' }}>
      <div ref={ref} className="w-full max-w-[360px]">
        <Link to="/login" className="flex items-center gap-2 text-white/30 text-xs hover:text-white/60 transition-colors mb-12">
          <ArrowLeft size={14} /> Back to sign in
        </Link>

        {sent ? (
          <div className="text-center">
            <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-6" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}>
              <Check size={20} className="text-white/60" />
            </div>
            <h2 className="font-equinox text-white text-2xl mb-3" style={{ letterSpacing: '0.04em' }}>Reset email sent</h2>
            <p className="text-white/40 text-sm mb-8">Check <span className="text-white/70">{email}</span> for a link to reset your password.</p>
            <Link to="/login" className="btn-primary text-sm">Back to sign in</Link>
          </div>
        ) : (
          <>
            <h1 className="font-equinox text-white text-3xl mb-2" style={{ letterSpacing: '0.04em' }}>Reset password</h1>
            <p className="text-white/35 text-sm mb-10">Enter your email and we'll send a reset link.</p>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="relative">
                <Mail size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/25" />
                <input type="email" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} className="input-field pl-11" autoFocus />
              </div>
              {error && <p className="text-xs px-4 py-3 rounded-md" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)' }}>{error}</p>}
              <button type="submit" disabled={loading} className="btn-primary w-full">
                {loading ? <div className="w-4 h-4 border border-black/20 border-t-black/60 rounded-full animate-spin" /> : 'Send reset link'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
