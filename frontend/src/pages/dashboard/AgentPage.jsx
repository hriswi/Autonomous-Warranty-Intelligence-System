/**
 * AgentPage.jsx
 * Full AI assistant interface connected to the local WarrantyAgent engine.
 * Conversation memory, typing animation, suggested prompts, reasoning trace toggle.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  MessageSquare, Send, ChevronDown, ChevronUp,
  Brain, Zap, RotateCcw, Shield, TrendingUp, Clock, AlertTriangle,
} from 'lucide-react';
import { useStore } from '../../store/store.js';
import { useAuth } from '../../hooks/useAuth.jsx';

// Suggested prompts — shown when conversation is empty
const SUGGESTED_PROMPTS = [
  { icon: Shield,       text: 'Can I claim warranty for my laptop keyboard issue?' },
  { icon: Clock,        text: 'Which of my products expire in the next 30 days?' },
  { icon: TrendingUp,   text: 'Which product has the highest failure risk?' },
  { icon: AlertTriangle,text: 'Why was my invoice flagged as suspicious?' },
  { icon: Brain,        text: 'Should I buy extended warranty for my Samsung TV?' },
  { icon: Zap,          text: 'Compare risk scores across all my devices' },
];

// ── Typing animation ──────────────────────────────────────────────────────────
function TypingDots() {
  return (
    <div className="flex items-center gap-1 py-1">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-white/30"
          style={{
            animation: `pulseSlow 1.4s ease-in-out ${i * 0.2}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

// ── Reasoning trace ───────────────────────────────────────────────────────────
function ReasoningTrace({ chain }) {
  const [open, setOpen] = useState(false);
  if (!chain?.length) return null;
  const completed = chain.filter((s) => s.status === 'COMPLETED');
  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-white/25 text-xs hover:text-white/45 transition-colors"
      >
        <Brain size={11} />
        {completed.length} reasoning stage{completed.length !== 1 ? 's' : ''}
        {open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
      </button>
      {open && (
        <div
          className="mt-2 rounded-[8px] p-3 flex flex-col gap-2"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          {chain.filter((s) => s.status !== 'SKIPPED').map((stage) => (
            <div key={stage.stage} className="flex items-start gap-2.5">
              <span className="text-[10px] mt-0.5" style={{
                color: stage.status === 'COMPLETED' ? 'rgba(255,255,255,0.4)' :
                       stage.status === 'DEGRADED'  ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.15)',
              }}>
                {stage.status === 'COMPLETED' ? '✓' : stage.status === 'DEGRADED' ? '~' : '✗'}
              </span>
              <div className="flex-1">
                <p className="text-white/35 text-xs">{stage.name}</p>
                {stage.notes?.slice(0, 1).map((n, i) => (
                  <p key={i} className="text-white/20 text-[11px] mt-0.5 leading-relaxed">{n}</p>
                ))}
              </div>
              {stage.confidence != null && (
                <span className="text-[10px] font-mono text-white/20 shrink-0">
                  {Math.round(stage.confidence * 100)}%
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Message bubble ────────────────────────────────────────────────────────────
function Message({ msg }) {
  const isUser = msg.role === 'user';

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[70%] px-4 py-3 rounded-[10px] text-sm"
          style={{
            background: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.12)',
            color: 'rgba(255,255,255,0.85)',
            lineHeight: 1.6,
          }}
        >
          {msg.content}
        </div>
      </div>
    );
  }

  // Agent message
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%]">
        {/* Agent avatar */}
        <div className="flex items-center gap-2 mb-2">
          <div
            className="w-5 h-5 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}
          >
            <Brain size={10} className="text-white/50" />
          </div>
          <span className="text-white/25 text-[11px] font-mono tracking-[0.1em]">AGENT</span>
          {msg.confidence != null && (
            <span className="text-white/15 text-[10px] font-mono">
              {Math.round(msg.confidence * 100)}% confidence
            </span>
          )}
        </div>

        {/* Content */}
        <div
          className="px-4 py-3 rounded-[10px] text-sm"
          style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.07)',
            color: 'rgba(255,255,255,0.65)',
            lineHeight: 1.7,
          }}
        >
          <div
            className="prose-sm"
            style={{ whiteSpace: 'pre-wrap' }}
            dangerouslySetInnerHTML={{
              __html: (msg.rawAnswer || msg.content)
                .replace(/\*\*(.*?)\*\*/g, '<strong style="color:rgba(255,255,255,0.85);font-weight:500">$1</strong>')
                .replace(/^---$/gm, '<hr style="border-color:rgba(255,255,255,0.08);margin:12px 0"/>')
                .replace(/^#{1,3}\s+(.+)$/gm, '<p style="color:rgba(255,255,255,0.5);font-size:10px;letter-spacing:0.1em;font-family:monospace;text-transform:uppercase;margin-bottom:8px">$1</p>')
                .replace(/^• /gm, '&nbsp;&nbsp;· ')
                .replace(/^(\d+)\. /gm, '&nbsp;&nbsp;$1. '),
            }}
          />
        </div>

        {/* Follow-up suggestions */}
        {msg.followUpSuggestions?.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {msg.followUpSuggestions.slice(0, 3).map((s, i) => (
              <button
                key={i}
                onClick={() => msg.onSuggestion?.(s)}
                className="text-[11px] px-3 py-1.5 rounded-full transition-all"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: 'rgba(255,255,255,0.4)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.07)';
                  e.currentTarget.style.color = 'rgba(255,255,255,0.7)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                  e.currentTarget.style.color = 'rgba(255,255,255,0.4)';
                }}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Reasoning trace */}
        {msg.chain && <ReasoningTrace chain={msg.chain} />}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function AgentPage() {
  const { products, agentMemory, setAgentMemory } = useStore();
  const { user } = useAuth();

  const [messages, setMessages] = useState([]);
  const [input, setInput]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [agent, setAgent]       = useState(null);
  const [initializing, setInitializing] = useState(true);

  const bottomRef  = useRef(null);
  const inputRef   = useRef(null);
  const agentRef   = useRef(null);

  // ── Init agent ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { WarrantyAgent } = await import('../../lib/warrantyEngine.js');

        const a = agentMemory
          ? WarrantyAgent.fromSerialized(JSON.parse(agentMemory))
          : new WarrantyAgent();

        // Load all current products into the agent graph
        for (const product of products) {
          try {
            a.addProductFromPipelineResult({
              invoice: product,
              risk:    product.risk    || null,
              advisory:product.advisory|| null,
              fraud:   product.fraud   || null,
            }, { id: product.id, nickname: product.productName });
          } catch (e) { /* continue */ }
        }

        if (!cancelled) {
          agentRef.current = a;
          setAgent(a);

          // Welcome message
          if (products.length === 0) {
            setMessages([{
              id: Date.now(), role: 'agent',
              content: `I'm your Warranty Intelligence Agent. I can answer questions about warranty coverage, claim eligibility, fraud signals, failure predictions, and more.\n\nStart by uploading a product invoice so I have something to reason about.`,
              rawAnswer: null, chain: null, confidence: null, followUpSuggestions: [],
            }]);
          } else {
            setMessages([{
              id: Date.now(), role: 'agent',
              content: `I'm tracking **${products.length}** product${products.length !== 1 ? 's' : ''} in your account. I understand their warranty status, risk scores, invoice integrity, and failure probabilities.\n\nWhat would you like to know?`,
              rawAnswer: null, chain: null, confidence: null,
              followUpSuggestions: [
                'Which products are expiring soon?',
                'Show me my highest risk device',
                'Are any invoices suspicious?',
              ],
            }]);
          }
        }
      } catch (err) {
        console.error('Agent init error:', err);
        if (!cancelled) {
          setMessages([{
            id: Date.now(), role: 'agent',
            content: 'Intelligence engine is loading. Please try your query in a moment.',
            rawAnswer: null, chain: null, confidence: null, followUpSuggestions: [],
          }]);
        }
      } finally {
        if (!cancelled) setInitializing(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // ── Send query ──────────────────────────────────────────────────────────
  const sendQuery = useCallback(async (query) => {
    if (!query?.trim() || loading || !agentRef.current) return;

    const userMsg = { id: Date.now(), role: 'user', content: query.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const response = await agentRef.current.query(query);

      const agentMsg = {
        id:       Date.now() + 1,
        role:     'agent',
        content:  response.answer,
        rawAnswer:response.rawAnswer,
        chain:    response.reasoningChain,
        confidence: response.overallConfidence,
        followUpSuggestions: response.followUpSuggestions,
        onSuggestion: sendQuery,
      };
      setMessages((prev) => [...prev, agentMsg]);

      // Persist memory
      try {
        const serialized = agentRef.current.serialize();
        setAgentMemory(JSON.stringify(serialized));
      } catch { /* non-critical */ }

    } catch (err) {
      console.error('Agent query error:', err);
      setMessages((prev) => [...prev, {
        id: Date.now() + 1, role: 'agent',
        content: 'I encountered an error processing that query. Please try again.',
        rawAnswer: null, chain: null, confidence: null, followUpSuggestions: [],
      }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [loading]);

  const handleSubmit = (e) => {
    e.preventDefault();
    sendQuery(input);
  };

  const handleReset = () => {
    setMessages([]);
    setAgentMemory(null);
    if (agentRef.current) {
      agentRef.current = null;
      setAgent(null);
      setInitializing(true);
      // Re-init
      setTimeout(() => window.location.reload(), 100);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full" style={{ maxHeight: 'calc(100vh - 56px)' }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 py-4 shrink-0"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: '#080808' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}
          >
            <Brain size={13} className="text-white/60" />
          </div>
          <div>
            <h1 className="font-equinox text-white text-sm tracking-[0.08em]">INTELLIGENCE AGENT</h1>
            <p className="text-white/25 text-[11px]">
              {initializing ? 'Initializing…' : `${products.length} product${products.length !== 1 ? 's' : ''} in context`}
            </p>
          </div>
        </div>
        <button
          onClick={handleReset}
          className="flex items-center gap-2 text-white/25 text-xs hover:text-white/50 transition-colors"
          title="Reset conversation"
        >
          <RotateCcw size={13} /> Reset
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-3xl mx-auto flex flex-col gap-6">
          {/* Suggested prompts (shown when conversation only has welcome) */}
          {messages.length === 1 && messages[0].role === 'agent' && (
            <div>
              <p className="text-white/20 text-xs font-mono tracking-[0.15em] uppercase mb-3">Suggested</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {SUGGESTED_PROMPTS.map(({ icon: Icon, text }, i) => (
                  <button
                    key={i}
                    onClick={() => sendQuery(text)}
                    disabled={loading || initializing}
                    className="flex items-center gap-3 px-4 py-3 rounded-[10px] text-left group transition-all"
                    style={{
                      background: 'rgba(255,255,255,0.025)',
                      border: '1px solid rgba(255,255,255,0.07)',
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
                    <Icon size={14} className="text-white/30 shrink-0 group-hover:text-white/50 transition-colors" />
                    <span className="text-white/45 text-sm group-hover:text-white/65 transition-colors leading-snug">
                      {text}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Message list */}
          {messages.map((msg) => (
            <Message key={msg.id} msg={{ ...msg, onSuggestion: sendQuery }} />
          ))}

          {/* Typing indicator */}
          {loading && (
            <div className="flex items-center gap-2">
              <div
                className="w-5 h-5 rounded-full flex items-center justify-center"
                style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}
              >
                <Brain size={10} className="text-white/50" />
              </div>
              <div
                className="px-4 py-3 rounded-[10px]"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
              >
                <TypingDots />
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input bar */}
      <div
        className="px-6 py-4 shrink-0"
        style={{ borderTop: '1px solid rgba(255,255,255,0.05)', background: '#050505' }}
      >
        <div className="max-w-3xl mx-auto">
          <form onSubmit={handleSubmit} className="flex gap-3">
            <div className="flex-1 relative">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={initializing ? 'Initializing agent…' : 'Ask anything about your warranties…'}
                disabled={loading || initializing}
                className="input-field w-full pr-4"
                style={{ paddingRight: '16px' }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendQuery(input); }
                }}
              />
            </div>
            <button
              type="submit"
              disabled={!input.trim() || loading || initializing}
              className="btn-primary px-4 py-2.5 shrink-0"
              style={{ minWidth: '44px' }}
            >
              <Send size={15} />
            </button>
          </form>
          <p className="text-white/15 text-[11px] mt-2 text-center font-mono">
            Reasoning locally · No cloud AI · All data stays on your device
          </p>
        </div>
      </div>
    </div>
  );
}
