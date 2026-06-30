/**
 * LandingPage.jsx
 *
 * The product's first impression. Monochrome, premium, minimal futuristic.
 * LightRays background in hero. SplitText for hero headline.
 * No generic SaaS template patterns.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import LightRays from '../components/ui/LightRays.jsx';
import SplitText from '../components/ui/SplitText.jsx';
import { Shield, Zap, Brain, Lock, FileSearch, TrendingUp, ArrowRight, ChevronDown } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

// ── Feature data ──────────────────────────────────────────────────────────────
const FEATURES = [
  {
    icon: Brain,
    label: 'AI Intelligence',
    title: 'Reasoning, not matching',
    body: 'The engine runs multi-stage inference across your entire product graph before answering — warranty status, exclusion rules, fraud signals, and risk curves all at once.',
  },
  {
    icon: FileSearch,
    label: 'OCR Pipeline',
    title: 'Invoice → structured data',
    body: 'Upload a photo of any invoice — Amazon, local retailer, blurry scan. The OCR layer extracts and cleans every field, flags what it is uncertain about, and lets you correct it.',
  },
  {
    icon: Shield,
    label: 'Claim Eligibility',
    title: 'Instant coverage decisions',
    body: 'Describe the issue in plain language. The engine checks manufacturer exclusion rules, determines coverage, detects overriding damage conditions, and explains every step.',
  },
  {
    icon: Zap,
    label: 'Autonomous Monitor',
    title: 'Alerts without asking',
    body: 'The agent continuously scans your product graph and surfaces critical events — expiring coverage windows, high-risk devices, suspicious invoices — before you need to check.',
  },
  {
    icon: TrendingUp,
    label: 'Failure Prediction',
    title: 'Probability, not guesswork',
    body: 'Per-component failure curves built from category-level reliability data, adjusted for product age, repair history, and reported symptoms. Quantified, not vague.',
  },
  {
    icon: Lock,
    label: 'Fraud Detection',
    title: 'Invoice integrity scoring',
    body: 'Structural anomaly detection, platform-pattern mismatch analysis, OCR noise concentration scoring, and date consistency validation — all without a single network call.',
  },
];

const HOW_IT_WORKS = [
  { step: '01', title: 'Upload any invoice', body: 'PDF, image, or photo. The OCR pipeline extracts and structures every field.' },
  { step: '02', title: 'Intelligence runs automatically', body: 'Classification, risk scoring, fraud detection, and warranty detection complete in under a second.' },
  { step: '03', title: 'Ask anything', body: 'Query the agent in plain language. It reasons across your entire product graph and explains its decisions.' },
  { step: '04', title: 'Act on what matters', body: 'Targeted alerts, claim guidance, and repair vs. replace recommendations — only when they are relevant to you.' },
];

// ── Sub-components ────────────────────────────────────────────────────────────

function NavBar() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 transition-all duration-300"
      style={{
        background: scrolled ? 'rgba(10,10,10,0.92)' : 'transparent',
        borderBottom: scrolled ? '1px solid rgba(255,255,255,0.06)' : 'none',
        backdropFilter: scrolled ? 'blur(20px)' : 'none',
      }}
    >
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <span className="font-equinox text-sm tracking-widest text-white">
          WARRANTY VAULT
        </span>
        <div className="flex items-center gap-3">
          <Link to="/login" className="btn-ghost py-2 px-5 text-xs">
            Sign in
          </Link>
          <Link to="/register" className="btn-primary py-2 px-5 text-xs">
            Get started
          </Link>
        </div>
      </div>
    </nav>
  );
}

function Hero() {
  const [headlineReady, setHeadlineReady] = useState(false);
  const subtitleRef = useRef(null);
  const ctaRef = useRef(null);

  const onSplitComplete = () => {
    gsap.to(subtitleRef.current, { opacity: 1, y: 0, duration: 0.7, ease: 'power2.out' });
    gsap.to(ctaRef.current, { opacity: 1, y: 0, duration: 0.7, delay: 0.15, ease: 'power2.out' });
  };

  useEffect(() => {
    if (subtitleRef.current) gsap.set(subtitleRef.current, { opacity: 0, y: 16 });
    if (ctaRef.current)      gsap.set(ctaRef.current, { opacity: 0, y: 16 });
    setHeadlineReady(true);
  }, []);

  return (
    <section
      className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden"
      style={{ background: '#000' }}
    >
      {/* LightRays WebGL background — prominently visible */}
      <LightRays
        intensity={0.9}
        style={{ opacity: 1 }}
      />

      {/* Subtle radial vignette to focus attention on text */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse 80% 60% at 50% 50%, transparent 0%, rgba(0,0,0,0.7) 100%)',
        }}
      />

      {/* Hero content */}
      <div className="relative z-10 text-center px-6 max-w-5xl mx-auto">
        {/* Eyebrow */}
        <div className="flex items-center justify-center gap-3 mb-10">
          <div className="h-px w-12 bg-white/20" />
          <span
            className="text-xs font-mono tracking-[0.3em] text-white/50 uppercase"
            style={{ fontFamily: 'JetBrains Mono, monospace' }}
          >
            Autonomous Warranty Intelligence
          </span>
          <div className="h-px w-12 bg-white/20" />
        </div>

        {/* Main headline — SplitText animated */}
        <h1
          className="font-equinox text-white leading-none mb-8"
          style={{ fontSize: 'clamp(3.5rem, 10vw, 8.5rem)', letterSpacing: '-0.02em' }}
        >
          {headlineReady && (
            <>
              <SplitText
                text="WARRANTY"
                delay={0.1}
                stagger={0.035}
                duration={0.75}
                onComplete={() => {}}
              />
              <br />
              <SplitText
                text="INTELLIGENCE"
                delay={0.5}
                stagger={0.035}
                duration={0.75}
                onComplete={onSplitComplete}
                className="text-white/70"
              />
            </>
          )}
        </h1>

        {/* Subtitle */}
        <p
          ref={subtitleRef}
          className="text-white/50 max-w-xl mx-auto mb-12 leading-relaxed"
          style={{ fontSize: 'clamp(0.9rem, 1.5vw, 1.1rem)' }}
        >
          Upload any invoice. The engine classifies the product, detects coverage
          windows, flags fraud signals, predicts failure curves — then explains every decision.
        </p>

        {/* CTAs */}
        <div ref={ctaRef} className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link to="/register" className="btn-primary text-sm px-8 py-4 rounded-[6px]">
            Start tracking warranties
            <ArrowRight size={15} />
          </Link>
          <Link to="/login" className="btn-ghost text-sm px-8 py-4 rounded-[6px]">
            Sign in
          </Link>
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 animate-bounce">
        <span className="text-white/25 text-[10px] font-mono tracking-[0.2em] uppercase">Scroll</span>
        <ChevronDown size={14} className="text-white/20" />
      </div>
    </section>
  );
}

function FeatureGrid() {
  const sectionRef = useRef(null);

  useEffect(() => {
    const cards = sectionRef.current?.querySelectorAll('.feature-card');
    if (!cards?.length) return;

    gsap.set(cards, { opacity: 0, y: 30 });
    ScrollTrigger.create({
      trigger: sectionRef.current,
      start: 'top 75%',
      onEnter: () => {
        gsap.to(cards, {
          opacity: 1, y: 0, duration: 0.65, ease: 'power2.out',
          stagger: 0.07,
        });
      },
    });
    return () => ScrollTrigger.getAll().forEach((t) => t.kill());
  }, []);

  return (
    <section ref={sectionRef} className="py-32 px-6">
      <div className="max-w-7xl mx-auto">
        {/* Section header */}
        <div className="mb-20">
          <p className="text-xs font-mono tracking-[0.25em] text-white/35 uppercase mb-4">
            Intelligence layer
          </p>
          <h2
            className="font-equinox text-white"
            style={{ fontSize: 'clamp(2rem, 4vw, 3.5rem)', letterSpacing: '0.02em' }}
          >
            Every decision explained
          </h2>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px" style={{ background: 'rgba(255,255,255,0.05)' }}>
          {FEATURES.map(({ icon: Icon, label, title, body }, i) => (
            <div
              key={i}
              className="feature-card group relative p-10"
              style={{
                background: '#000',
                transition: 'background 250ms ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#0D0D0D'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = '#000'; }}
            >
              {/* Label */}
              <span className="text-[10px] font-mono tracking-[0.25em] text-white/30 uppercase block mb-8">
                {label}
              </span>

              {/* Icon */}
              <div className="mb-6">
                <Icon size={22} className="text-white/60" strokeWidth={1.5} />
              </div>

              {/* Title */}
              <h3 className="font-equinox text-white text-base mb-3" style={{ letterSpacing: '0.04em' }}>
                {title}
              </h3>

              {/* Body */}
              <p className="text-white/40 text-sm leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const ref = useRef(null);

  useEffect(() => {
    const items = ref.current?.querySelectorAll('.step-item');
    if (!items?.length) return;
    gsap.set(items, { opacity: 0, x: -20 });
    ScrollTrigger.create({
      trigger: ref.current,
      start: 'top 70%',
      onEnter: () => {
        gsap.to(items, { opacity: 1, x: 0, duration: 0.6, ease: 'power2.out', stagger: 0.12 });
      },
    });
  }, []);

  return (
    <section ref={ref} className="py-32 px-6" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-20 items-center">
          <div>
            <p className="text-xs font-mono tracking-[0.25em] text-white/35 uppercase mb-4">
              How it works
            </p>
            <h2
              className="font-equinox text-white mb-6"
              style={{ fontSize: 'clamp(2rem, 4vw, 3rem)', letterSpacing: '0.02em' }}
            >
              Upload once.<br />Know everything.
            </h2>
            <p className="text-white/40 leading-relaxed max-w-md">
              One invoice upload triggers a full intelligence sweep: classification, risk scoring,
              fraud detection, warranty detection, and failure prediction. No manual configuration.
            </p>
          </div>

          <div className="flex flex-col gap-0">
            {HOW_IT_WORKS.map(({ step, title, body }, i) => (
              <div
                key={i}
                className="step-item flex gap-8 py-8"
                style={{
                  borderBottom: i < HOW_IT_WORKS.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                }}
              >
                <span
                  className="font-mono text-xs text-white/20 shrink-0 pt-1"
                  style={{ letterSpacing: '0.1em', minWidth: '28px' }}
                >
                  {step}
                </span>
                <div>
                  <h4 className="font-equinox text-white text-sm mb-2" style={{ letterSpacing: '0.04em' }}>
                    {title}
                  </h4>
                  <p className="text-white/35 text-sm leading-relaxed">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function AISection() {
  const ref = useRef(null);

  useEffect(() => {
    ScrollTrigger.create({
      trigger: ref.current,
      start: 'top 70%',
      onEnter: () => {
        gsap.to(ref.current?.querySelectorAll('.ai-reveal'), {
          opacity: 1, y: 0, duration: 0.7, ease: 'power2.out', stagger: 0.1,
        });
      },
    });
    gsap.set(ref.current?.querySelectorAll('.ai-reveal'), { opacity: 0, y: 24 });
  }, []);

  const exampleQueries = [
    'My Dell laptop keyboard stopped working. Can I claim warranty?',
    'Which of my products expire in the next 30 days?',
    'Should I buy extended warranty for my Samsung TV?',
    'Why was this invoice flagged as suspicious?',
  ];

  return (
    <section ref={ref} className="py-32 px-6" style={{ background: '#050505', borderTop: '1px solid rgba(255,255,255,0.05)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      <div className="max-w-7xl mx-auto">
        <div className="ai-reveal mb-4">
          <p className="text-xs font-mono tracking-[0.25em] text-white/35 uppercase">
            Warranty Intelligence Agent
          </p>
        </div>
        <h2
          className="ai-reveal font-equinox text-white mb-16"
          style={{ fontSize: 'clamp(2rem, 4vw, 3.5rem)', letterSpacing: '0.02em', maxWidth: '600px' }}
        >
          Ask anything about your warranties
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-3xl">
          {exampleQueries.map((q, i) => (
            <div
              key={i}
              className="ai-reveal group p-5"
              style={{
                background: 'rgba(255,255,255,0.025)',
                border: '1px solid rgba(255,255,255,0.07)',
                borderRadius: '10px',
                cursor: 'default',
                transition: 'background 200ms ease, border-color 200ms ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.045)';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.13)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.025)';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)';
              }}
            >
              <div className="flex items-start gap-3">
                <span className="text-white/15 text-xs font-mono mt-0.5">›</span>
                <p className="text-white/55 text-sm leading-relaxed">{q}</p>
              </div>
            </div>
          ))}
        </div>

        <p className="ai-reveal text-white/25 text-sm mt-8">
          The agent maintains context across your conversation — it remembers which product
          you were discussing and resolves follow-up questions without re-stating context.
        </p>
      </div>
    </section>
  );
}

function SecuritySection() {
  const ref = useRef(null);
  useEffect(() => {
    gsap.set(ref.current?.querySelectorAll('.sec-item'), { opacity: 0, y: 16 });
    ScrollTrigger.create({
      trigger: ref.current,
      start: 'top 75%',
      onEnter: () => gsap.to(ref.current?.querySelectorAll('.sec-item'), {
        opacity: 1, y: 0, duration: 0.55, ease: 'power2.out', stagger: 0.06,
      }),
    });
  }, []);

  const items = [
    'No data leaves your device for AI processing',
    'Per-user Firestore security rules enforced at database level',
    'Rate-limited authentication with brute-force protection',
    'Malicious file type detection before upload',
    'XSS and injection protection on all inputs',
    'Session isolation — no cross-account data access',
  ];

  return (
    <section ref={ref} className="py-32 px-6">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-20 items-start">
          <div>
            <p className="sec-item text-xs font-mono tracking-[0.25em] text-white/35 uppercase mb-4">
              Security
            </p>
            <h2
              className="sec-item font-equinox text-white mb-6"
              style={{ fontSize: 'clamp(2rem, 4vw, 3rem)', letterSpacing: '0.02em' }}
            >
              Local-first.<br />No cloud AI.
            </h2>
            <p className="sec-item text-white/40 leading-relaxed max-w-md">
              Every intelligence decision runs in your browser or on your server.
              No invoice data is sent to a third-party AI API. No OpenAI, no Gemini,
              no paid LLM endpoint — ever.
            </p>
          </div>
          <div className="flex flex-col gap-0">
            {items.map((item, i) => (
              <div
                key={i}
                className="sec-item flex items-center gap-5 py-5"
                style={{ borderBottom: i < items.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}
              >
                <div className="w-1 h-1 rounded-full bg-white/30 shrink-0" />
                <span className="text-white/50 text-sm">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function CTASection() {
  const ref = useRef(null);
  useEffect(() => {
    gsap.set(ref.current, { opacity: 0, y: 30 });
    ScrollTrigger.create({
      trigger: ref.current,
      start: 'top 80%',
      onEnter: () => gsap.to(ref.current, { opacity: 1, y: 0, duration: 0.8, ease: 'power2.out' }),
    });
  }, []);

  return (
    <section
      ref={ref}
      className="py-40 px-6 text-center"
      style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
    >
      <div className="max-w-3xl mx-auto">
        <p className="text-xs font-mono tracking-[0.25em] text-white/30 uppercase mb-6">
          Ready
        </p>
        <h2
          className="font-equinox text-white mb-8"
          style={{ fontSize: 'clamp(2.5rem, 6vw, 5rem)', letterSpacing: '0.02em', lineHeight: '1' }}
        >
          Every warranty.<br />Under control.
        </h2>
        <p className="text-white/40 mb-12 max-w-md mx-auto">
          Free to use. No paid APIs. Deploy on Firebase at zero cost.
        </p>
        <Link to="/register" className="btn-primary text-sm px-10 py-4">
          Create your account
          <ArrowRight size={15} />
        </Link>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer
      className="py-10 px-6"
      style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
    >
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <span className="font-equinox text-xs tracking-[0.2em] text-white/30">WARRANTY VAULT</span>
        <p className="text-white/20 text-xs font-mono">
          Local-first · Free · Open source
        </p>
      </div>
    </footer>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function LandingPage() {
  return (
    <div className="min-h-screen" style={{ background: '#000' }}>
      <NavBar />
      <Hero />
      <FeatureGrid />
      <HowItWorks />
      <AISection />
      <SecuritySection />
      <CTASection />
      <Footer />
    </div>
  );
}
