/**
 * LightRays.jsx
 *
 * OGL WebGL light ray background — interactive, mouse-tracking,
 * visually prominent. Used as the hero section background per spec.
 *
 * Renders animated volumetric light rays using OGL's WebGL layer.
 * Mouse position drives the ray focal point for interactivity.
 */
import React, { useEffect, useRef } from 'react';
import { Renderer, Program, Mesh, Triangle } from 'ogl';

const VERTEX_SHADER = /* glsl */`
  attribute vec2 position;
  attribute vec2 uv;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 0, 1);
  }
`;

const FRAGMENT_SHADER = /* glsl */`
  precision highp float;

  uniform float uTime;
  uniform vec2  uResolution;
  uniform vec2  uMouse;
  uniform float uIntensity;

  varying vec2 vUv;

  #define PI 3.14159265
  #define NUM_RAYS 12

  float hash(float n) { return fract(sin(n) * 43758.5453123); }

  float ray(vec2 uv, vec2 origin, float angle, float width, float falloff) {
    vec2 dir = vec2(cos(angle), sin(angle));
    vec2 perp = vec2(-dir.y, dir.x);
    vec2 delta = uv - origin;
    float along = dot(delta, dir);
    float across = dot(delta, perp);
    float mask = smoothstep(width, 0.0, abs(across));
    float depth = smoothstep(-0.1, falloff, along);
    return mask * depth;
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy / uResolution) * 2.0 - 1.0;
    uv.x *= uResolution.x / uResolution.y;

    // Mouse-driven focal point
    vec2 mouse = uMouse * vec2(uResolution.x / uResolution.y, 1.0);
    vec2 origin = mouse * 0.5;

    float brightness = 0.0;
    float t = uTime * 0.18;

    for (int i = 0; i < NUM_RAYS; i++) {
      float fi = float(i);
      float baseAngle = fi * (PI * 2.0 / float(NUM_RAYS));
      float wobble = sin(t * (0.6 + hash(fi) * 0.8) + fi * 1.7) * 0.18;
      float angle = baseAngle + wobble;
      float width = 0.012 + hash(fi * 3.1) * 0.018;
      float intensity = 0.4 + hash(fi * 7.3) * 0.6;
      float falloff = 0.5 + hash(fi * 2.7) * 1.0;
      brightness += ray(uv, origin, angle, width, falloff) * intensity;
    }

    // Add a subtle inner glow at the focal point
    float glow = 1.0 - smoothstep(0.0, 0.25, length(uv - origin));
    brightness += glow * 0.08;

    brightness *= uIntensity;

    // Monochrome: pure white rays
    vec3 color = vec3(brightness);
    float alpha = brightness * 0.65;

    gl_FragColor = vec4(color, alpha);
  }
`;

export default function LightRays({
  intensity = 0.85,
  className = '',
  style = {},
}) {
  const canvasRef = useRef(null);
  const stateRef  = useRef({ mouse: [0, 0], animId: null });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new Renderer({ canvas, alpha: true, antialias: false });
    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);

    const geometry = new Triangle(gl);

    const program = new Program(gl, {
      vertex: VERTEX_SHADER,
      fragment: FRAGMENT_SHADER,
      uniforms: {
        uTime:       { value: 0 },
        uResolution: { value: [canvas.clientWidth, canvas.clientHeight] },
        uMouse:      { value: [0, 0] },
        uIntensity:  { value: intensity },
      },
      transparent: true,
      depthTest: false,
    });

    const mesh = new Mesh(gl, { geometry, program });

    const resize = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      renderer.setSize(w, h);
      program.uniforms.uResolution.value = [w, h];
    };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas.parentElement || document.body);
    resize();

    const onMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      stateRef.current.mouse = [
        ((e.clientX - rect.left) / rect.width)  * 2 - 1,
        -(((e.clientY - rect.top)  / rect.height) * 2 - 1),
      ];
    };
    window.addEventListener('mousemove', onMouseMove, { passive: true });

    let start = performance.now();
    const animate = (now) => {
      stateRef.current.animId = requestAnimationFrame(animate);
      const elapsed = (now - start) / 1000;
      program.uniforms.uTime.value  = elapsed;
      program.uniforms.uMouse.value = stateRef.current.mouse;
      renderer.render({ scene: mesh });
    };
    stateRef.current.animId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(stateRef.current.animId);
      window.removeEventListener('mousemove', onMouseMove);
      ro.disconnect();
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, [intensity]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        ...style,
      }}
    />
  );
}
