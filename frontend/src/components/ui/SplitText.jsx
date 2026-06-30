/**
 * SplitText.jsx
 *
 * GSAP-powered character-by-character text animation.
 * Used exclusively in the hero section per spec.
 *
 * Each character is split into its own span, then animated
 * in with a staggered ease using GSAP's core timeline.
 */
import React, { useEffect, useRef } from 'react';
import { gsap } from 'gsap';

export default function SplitText({
  text,
  className = '',
  delay = 0,
  stagger = 0.03,
  duration = 0.7,
  y = 24,
  onComplete,
}) {
  const containerRef = useRef(null);
  const chars = text.split('');

  useEffect(() => {
    const ctx = gsap.context(() => {
      const spans = containerRef.current?.querySelectorAll('.split-char');
      if (!spans?.length) return;

      gsap.set(spans, { opacity: 0, y, rotateX: -20 });

      gsap.to(spans, {
        opacity: 1,
        y: 0,
        rotateX: 0,
        duration,
        ease: 'power3.out',
        stagger,
        delay,
        onComplete,
      });
    }, containerRef);

    return () => ctx.revert();
  }, [text, delay, stagger, duration, y]);

  return (
    <span
      ref={containerRef}
      className={className}
      style={{ display: 'inline-block', perspective: '600px' }}
      aria-label={text}
    >
      {chars.map((char, i) => (
        <span
          key={i}
          className="split-char"
          style={{
            display: 'inline-block',
            whiteSpace: char === ' ' ? 'pre' : 'normal',
            transformOrigin: 'center bottom',
          }}
          aria-hidden="true"
        >
          {char === ' ' ? '\u00A0' : char}
        </span>
      ))}
    </span>
  );
}
