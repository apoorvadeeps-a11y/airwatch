import React, { useEffect, useRef, useState } from "react";
import { Camera, Radar, ShieldAlert, Wind, ArrowRight, Languages, WifiOff, Activity } from "lucide-react";
import * as THREE from "three";

/**
 * AirWatch — Landing / intro page (v3: mobile-aware + human "helping each other" hologram)
 * ---------------------------------------------------------------
 * Drop this in alongside App.jsx.
 *
 *   const [entered, setEntered] = useState(false);
 *   return entered ? <App /> : <LandingPage onEnter={() => setEntered(true)} />;
 *
 * Dependencies: lucide-react (already in your app) + three.js (new — run
 * `npm install three` in your project before using this file).
 *
 * Mobile handling:
 * - Touch drags now drive the same "clear the haze" interaction cursor does on desktop.
 * - Particle count, 3D polygon detail, and pixel ratio all scale down under a width
 *   breakpoint to protect frame rate on phones.
 * - Magnetic button / card tilt / cursor glow stay desktop-only (pointer: fine) since
 *   they don't make sense with a finger already on the screen.
 * - Header/footer respect safe-area insets in case this is wrapped in a native shell.
 * - The 3D layer fails silently if WebGL is unavailable — the rest of the page still works.
 */

export function useFinePointer() {
  const [fine, setFine] = useState(false);
  useEffect(() => setFine(window.matchMedia("(pointer: fine)").matches), []);
  return fine;
}

export function useIsMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const check = () => setMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return mobile;
}

// ---------- foreground: swirling haze -> clean ring, reacts to cursor drag or finger drag ----------
function ParticleField({ mouseRef, isMobile }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2);
    let w, h, cx, cy, ringR;

    const COUNT = isMobile ? 70 : 140;
    const particles = [];

    function resize() {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx = w * 0.5;
      cy = h * 0.46;
      ringR = Math.min(w, h) * (isMobile ? 0.32 : 0.26);
    }
    resize();
    window.addEventListener("resize", resize);

    const hazeColors = ["#f59e0b", "#ef4444", "#f97316", "#eab308"];
    const cleanColors = ["#34d399", "#22d3ee", "#10b981", "#38bdf8"];

    for (let i = 0; i < COUNT; i++) {
      const angle = (i / COUNT) * Math.PI * 2;
      const jitterR = ringR + (Math.random() - 0.5) * 14;
      particles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        size: 1.4 + Math.random() * 2.2,
        angle,
        jitterR,
        speed: 0.15 + Math.random() * 0.15,
        phase: Math.random() * Math.PI * 2,
        color: hazeColors[i % hazeColors.length],
        targetColor: cleanColors[i % cleanColors.length],
        glow: 0,
      });
    }

    let rotation = 0;
    let t0 = performance.now();
    let convergeStart = null;
    const CONVERGE_MS = 2400;
    const REPEL_RADIUS = isMobile ? 150 : 190;
    let raf;

    function lerp(a, b, n) { return a + (b - a) * n; }
    function hexLerp(hexA, hexB, n) {
      const a = parseInt(hexA.slice(1), 16), b = parseInt(hexB.slice(1), 16);
      const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
      const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
      return `rgb(${Math.round(lerp(ar, br, n))},${Math.round(lerp(ag, bg, n))},${Math.round(lerp(ab, bb, n))})`;
    }

    function frame(now) {
      const dt = now - t0;
      t0 = now;
      if (convergeStart === null) convergeStart = now;
      const elapsed = now - convergeStart;
      const progress = reduceMotion ? 1 : Math.min(1, elapsed / CONVERGE_MS);
      const eased = 1 - Math.pow(1 - progress, 3);

      rotation += dt * 0.00012;
      const pulse = Math.sin(now * 0.0016) * 6;
      const mouse = mouseRef.current;

      ctx.clearRect(0, 0, w, h);

      for (const p of particles) {
        const targetX = cx + Math.cos(p.angle + rotation) * (p.jitterR + pulse);
        const targetY = cy + Math.sin(p.angle + rotation) * (p.jitterR + pulse) * 0.72;

        if (progress < 1) {
          p.x = lerp(p.x, targetX, 0.04 + eased * 0.02);
          p.y = lerp(p.y, targetY, 0.04 + eased * 0.02);
        } else {
          const wob = Math.sin(now * 0.002 * p.speed + p.phase) * 2.2;
          p.x = lerp(p.x, targetX + wob, 0.08);
          p.y = lerp(p.y, targetY + wob * 0.6, 0.08);
        }

        if (mouse.x !== null) {
          const dx = p.x - mouse.x, dy = p.y - mouse.y;
          const dist = Math.hypot(dx, dy) || 1;
          if (dist < REPEL_RADIUS) {
            const closeness = 1 - dist / REPEL_RADIUS;
            const force = Math.pow(closeness, 1.6) * 90;
            p.x += (dx / dist) * force * 0.09;
            p.y += (dy / dist) * force * 0.09;
            p.glow = Math.min(1, p.glow + closeness * 0.6);
          }
        }
        p.glow *= 0.9;

        const baseCol = hexLerp(p.color, p.targetColor, eased);
        const col = p.glow > 0.02 ? hexLerp(baseCol, "#ffffff", p.glow * 0.7) : baseCol;

        ctx.beginPath();
        ctx.fillStyle = col;
        ctx.globalAlpha = 0.55 + eased * 0.4 + p.glow * 0.3;
        ctx.arc(p.x, p.y, p.size + eased * 0.6 + p.glow * 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    function onMove(e) {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current.x = e.clientX - rect.left;
      mouseRef.current.y = e.clientY - rect.top;
    }
    function onTouchMove(e) {
      if (!e.touches || !e.touches[0]) return;
      const rect = canvas.getBoundingClientRect();
      mouseRef.current.x = e.touches[0].clientX - rect.left;
      mouseRef.current.y = e.touches[0].clientY - rect.top;
    }
    function onLeave() {
      mouseRef.current.x = null;
      mouseRef.current.y = null;
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseleave", onLeave);
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onLeave);
    window.addEventListener("touchcancel", onLeave);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onLeave);
      window.removeEventListener("touchcancel", onLeave);
    };
  }, [mouseRef, isMobile]);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" aria-hidden="true" />;
}

function CursorGlow({ mouseRef, fine }) {
  const glowRef = useRef(null);
  const pos = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!fine) return;
    let raf;
    function tick() {
      const m = mouseRef.current;
      if (m.x !== null && glowRef.current) {
        pos.current.x += (m.x - pos.current.x) * 0.08;
        pos.current.y += (m.y - pos.current.y) * 0.08;
        glowRef.current.style.transform = `translate3d(${pos.current.x - 160}px, ${pos.current.y - 160}px, 0)`;
        glowRef.current.style.opacity = "1";
      } else if (glowRef.current) {
        glowRef.current.style.opacity = "0";
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mouseRef, fine]);

  if (!fine) return null;
  return (
    <div
      ref={glowRef}
      className="pointer-events-none absolute top-0 left-0 w-80 h-80 rounded-full opacity-0 transition-opacity duration-300"
      style={{ background: "radial-gradient(circle, rgba(52,211,153,0.16) 0%, rgba(56,189,248,0.08) 45%, transparent 70%)" }}
    />
  );
}

function MagneticButton({ onEnter, fine }) {
  const btnRef = useRef(null);
  const [hovered, setHovered] = useState(false);

  function handleMove(e) {
    if (!fine || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const relX = e.clientX - (rect.left + rect.width / 2);
    const relY = e.clientY - (rect.top + rect.height / 2);
    btnRef.current.style.transform = `translate(${relX * 0.25}px, ${relY * 0.35}px)`;
  }
  function handleLeave() {
    setHovered(false);
    if (btnRef.current) btnRef.current.style.transform = "translate(0,0)";
  }

  return (
    <button
      ref={btnRef}
      onClick={onEnter}
      onMouseEnter={() => setHovered(true)}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      className="mt-10 group relative inline-flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-emerald-500 active:from-emerald-500 active:to-emerald-400 hover:from-emerald-500 hover:to-emerald-400 text-white font-semibold px-7 py-4 sm:py-3.5 rounded-xl shadow-lg shadow-emerald-900/40 min-h-[48px]"
      style={{ transition: "transform 0.15s ease-out, background 0.2s, box-shadow 0.2s" }}
    >
      <span
        className="pointer-events-none absolute -inset-1 rounded-xl bg-emerald-400/30 blur-md transition-opacity duration-300"
        style={{ opacity: hovered ? 1 : 0 }}
      />
      <span className="relative">Enter AirWatch</span>
      <ArrowRight className={`relative w-4 h-4 transition-transform duration-300 ${hovered ? "translate-x-1" : ""}`} />
    </button>
  );
}

function TiltCard({ icon: Icon, label, fine }) {
  const cardRef = useRef(null);

  function handleMove(e) {
    if (!fine || !cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    cardRef.current.style.transform = `perspective(500px) rotateX(${-py * 10}deg) rotateY(${px * 12}deg) translateZ(4px)`;
  }
  function handleLeave() {
    if (cardRef.current) cardRef.current.style.transform = "perspective(500px) rotateX(0) rotateY(0)";
  }

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      className="flex flex-col items-center gap-2 bg-gray-900/50 border border-gray-800 rounded-xl px-3 py-4 text-center active:border-emerald-700/60 hover:border-emerald-700/60 hover:bg-gray-900/80 transition-colors duration-200 will-change-transform min-h-[64px] justify-center"
      style={{ transition: "transform 0.12s ease-out, border-color 0.2s, background-color 0.2s" }}
    >
      <Icon className="w-4 h-4 text-emerald-400" />
      <span className="text-[11px] text-gray-400 leading-tight">{label}</span>
    </div>
  );
}

// ---------- ambient 3D background: elegant data constellation ----------
// Replaces the humanoid scene with a highly professional, abstract sensor network.
// A flowing terrain of glowing nodes that gently react to cursor movement,
// conveying "vast amounts of data points forming a clear picture".
export function DataConstellation3D({ mouseRef, fine, isMobile }) {
  const mountRef = useRef(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let renderer, scene, camera, raf;
    let disposed = false;

    try {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const w = mount.clientWidth, h = mount.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2);

      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 100);
      camera.position.set(0, 4, 12);
      camera.lookAt(0, -1, 0);

      renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: "high-performance" });
      renderer.setSize(w, h);
      renderer.setPixelRatio(dpr);
      mount.appendChild(renderer.domElement);

      scene.add(new THREE.AmbientLight(0xffffff, 0.2));

      // Create a grid of points
      const countX = isMobile ? 35 : 65;
      const countZ = isMobile ? 35 : 65;
      const particleCount = countX * countZ;

      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(particleCount * 3);
      const originalY = new Float32Array(particleCount);
      const sizes = new Float32Array(particleCount);
      const colors = new Float32Array(particleCount * 3);

      const color1 = new THREE.Color(0x34d399); // Emerald
      const color2 = new THREE.Color(0x38bdf8); // Blue

      let i = 0;
      for (let ix = 0; ix < countX; ix++) {
        for (let iz = 0; iz < countZ; iz++) {
          const x = (ix - countX / 2) * 0.4;
          const z = (iz - countZ / 2) * 0.4;
          const y = (Math.sin(x * 0.5) + Math.cos(z * 0.5)) * 0.5;

          positions[i * 3] = x;
          positions[i * 3 + 1] = y;
          positions[i * 3 + 2] = z;

          originalY[i] = y;
          sizes[i] = Math.random() * 2 + 1;

          // Mix colors based on position
          const mix = (x / (countX * 0.4)) + 0.5;
          const pointColor = color1.clone().lerp(color2, mix + (Math.random() - 0.5) * 0.2);

          colors[i * 3] = pointColor.r;
          colors[i * 3 + 1] = pointColor.g;
          colors[i * 3 + 2] = pointColor.b;

          i++;
        }
      }

      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

      // We use a custom shader material to get size attenuation and varied opacity easily
      const material = new THREE.PointsMaterial({
        size: 0.06,
        vertexColors: true,
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });

      const particles = new THREE.Points(geometry, material);
      particles.position.y = -2.5;
      scene.add(particles);

      // Add a subtle glowing grid plane below
      const gridHelper = new THREE.GridHelper(30, 60, 0x34d399, 0x1e293b);
      gridHelper.position.y = -4;
      gridHelper.material.transparent = true;
      gridHelper.material.opacity = 0.15;
      scene.add(gridHelper);

      function onResize() {
        const nw = mount.clientWidth, nh = mount.clientHeight;
        camera.aspect = nw / nh;
        camera.updateProjectionMatrix();
        renderer.setSize(nw, nh);
      }
      window.addEventListener("resize", onResize);

      let mouseX = 0;
      let mouseY = 0;
      let targetCameraX = 0;
      let targetCameraY = 4;

      function animate(now) {
        if (disposed) return;
        const t = now * 0.0005;

        if (!reduceMotion) {
          const positions = particles.geometry.attributes.position.array;

          if (fine && !isMobile && mouseRef?.current?.x != null) {
            mouseX = (mouseRef.current.x / window.innerWidth) * 2 - 1;
            mouseY = -(mouseRef.current.y / window.innerHeight) * 2 + 1;

            targetCameraX = mouseX * 3;
            targetCameraY = 4 + mouseY * 2;
          }

          // Smooth camera parallax
          camera.position.x += (targetCameraX - camera.position.x) * 0.03;
          camera.position.y += (targetCameraY - camera.position.y) * 0.03;
          camera.lookAt(0, -1, 0);
          particles.rotation.y = t * 0.05;

          // Wave animation
          for (let i = 0; i < particleCount; i++) {
            const ix = i * 3;
            const x = positions[ix];
            const z = positions[ix + 2];

            // Complex wave interference pattern
            const wave1 = Math.sin(x * 0.5 + t);
            const wave2 = Math.cos(z * 0.4 - t * 0.8);
            const wave3 = Math.sin(Math.sqrt(x * x + z * z) * 0.3 - t * 1.2);

            // Calculate distance to origin for a subtle breathing effect
            const dist = Math.sqrt(x * x + z * z);
            const ripple = Math.sin(dist * 0.5 - t * 2) * 0.2;

            positions[ix + 1] = originalY[i] + (wave1 * wave2 + wave3) * 0.6 + ripple;
          }
          particles.geometry.attributes.position.needsUpdate = true;
        }

        renderer.render(scene, camera);
        raf = requestAnimationFrame(animate);
      }
      raf = requestAnimationFrame(animate);

      return () => {
        disposed = true;
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", onResize);
        geometry.dispose();
        material.dispose();
        gridHelper.geometry.dispose();
        gridHelper.material.dispose();
        renderer.dispose();
        if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
      };
    } catch (e) {
      console.warn("DataConstellation3D disabled:", e);
      setFailed(true);
    }
  }, [mouseRef, fine, isMobile]);

  if (failed) return null;
  return (
    <div ref={mountRef} className="absolute inset-0 w-full h-full opacity-60" style={{ mixBlendMode: 'screen' }} aria-hidden="true" />
  );
}

export default function LandingPage({ onEnter, mouseRef, fine, isMobile }) {
  const heroRef = useRef(null);
  const badgeRef = useRef(null);

  useEffect(() => {
    if (!fine || isMobile) return;
    let raf;
    function tick() {
      const m = mouseRef.current;
      if (m.x !== null && heroRef.current) {
        const nx = (m.x / window.innerWidth - 0.5) * 2;
        const ny = (m.y / window.innerHeight - 0.5) * 2;
        heroRef.current.style.transform = `translate3d(${nx * -6}px, ${ny * -4}px, 0)`;
        if (badgeRef.current) badgeRef.current.style.transform = `translate3d(${nx * 10}px, ${ny * 8}px, 0)`;
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [fine, isMobile]);

  return (
    <div
      className="relative min-h-screen w-full bg-transparent text-white overflow-hidden cursor-default"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <style>{`
        @keyframes floatY { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
        @keyframes ringPulse { 0% { box-shadow: 0 0 0 0 rgba(52,211,153,0.35); } 70% { box-shadow: 0 0 0 12px rgba(52,211,153,0); } 100% { box-shadow: 0 0 0 0 rgba(52,211,153,0); } }
        @keyframes shimmer { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }
        .float-badge { animation: floatY 4.5s ease-in-out infinite; }
        .live-dot { animation: ringPulse 2.2s ease-out infinite; }
        .shimmer-text { background-size: 200% auto; animation: shimmer 5s linear infinite; }
        @media (prefers-reduced-motion: reduce) {
          .float-badge, .live-dot, .shimmer-text { animation: none; }
        }
      `}</style>

      {/* DataConstellation3D is now rendered at the App level */}

      <div className="pointer-events-none absolute top-1/4 left-1/2 -translate-x-1/2 w-[32rem] h-[32rem] bg-emerald-500/10 rounded-full blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 right-0 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl" />

      <ParticleField mouseRef={mouseRef} isMobile={isMobile} />
      <CursorGlow mouseRef={mouseRef} fine={fine} />

      <div
        ref={badgeRef}
        className="float-badge hidden md:flex absolute top-28 right-10 items-center gap-2 bg-gray-900/70 backdrop-blur border border-gray-800 rounded-full pl-2 pr-4 py-2 z-10"
      >
        <span className="live-dot w-2 h-2 rounded-full bg-emerald-400" />
        <Activity className="w-3.5 h-3.5 text-emerald-400" />
        <span className="text-[11px] text-gray-300">Live station data streaming</span>
      </div>

      <div className="relative z-10 flex flex-col min-h-screen">
        <header className="flex items-center justify-between px-5 sm:px-10 py-5 sm:py-6">
          <span className="text-base sm:text-lg font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-blue-500">
            🌿 AirWatch
          </span>
          <div className="flex items-center gap-2 sm:gap-4 text-[10px] sm:text-xs text-gray-400">
            <span className="flex items-center gap-1.5 bg-gray-900/60 border border-gray-800 rounded-full px-2.5 sm:px-3 py-1 sm:py-1.5">
              <Languages className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-emerald-400" />
              <span className="hidden xs:inline">5 languages</span>
              <span className="xs:hidden">5 lang</span>
            </span>
            <span className="hidden sm:flex items-center gap-1.5 bg-gray-900/60 border border-gray-800 rounded-full px-3 py-1.5">
              <WifiOff className="w-3.5 h-3.5 text-emerald-400" /> Works over WhatsApp
            </span>
          </div>
        </header>

        <main ref={heroRef} className="flex-1 flex flex-col items-center justify-center text-center px-5 sm:px-6 -mt-6 sm:-mt-8 will-change-transform">
          <p className="text-[10px] sm:text-xs uppercase tracking-[0.2em] text-emerald-400/80 font-semibold mb-3 sm:mb-4">
            Hyperlocal pollution, made visible
          </p>
          <h1 className="text-3xl sm:text-6xl font-bold tracking-tight max-w-3xl leading-[1.08] sm:leading-[1.05]">
            Every scattered signal,
            <br />
            <span className="shimmer-text text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-blue-400 to-emerald-400">
              one clear picture.
            </span>
          </h1>
          <p className="mt-5 sm:mt-6 max-w-xl text-gray-400 text-sm leading-relaxed">
            A garbage fire, a smog trap at a junction, a dust cloud from a site —
            AirWatch turns citizen photos and live sensor data into hotspots
            authorities can act on, before the air gets worse.
          </p>

          <MagneticButton onEnter={onEnter} fine={fine} />
          <p className="mt-3 text-[11px] text-gray-600">
            {isMobile ? "Drag your finger over the haze above — watch it clear." : "Move your cursor over the haze above — watch it clear."}
          </p>
        </main>

        <footer className="px-5 sm:px-10 pb-8 sm:pb-10">
          <div className="max-w-4xl mx-auto grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
            {[
              { icon: Camera, label: "Report with a photo" },
              { icon: Radar, label: "Spot hidden hotspots" },
              { icon: Wind, label: "24h AQI prediction" },
              { icon: ShieldAlert, label: "Alert municipal teams" },
            ].map(({ icon, label }, i) => (
              <TiltCard key={i} icon={icon} label={label} fine={fine} />
            ))}
          </div>
        </footer>
      </div>
    </div>
  );
}
