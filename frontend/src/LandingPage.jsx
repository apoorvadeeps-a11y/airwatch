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

function useFinePointer() {
  const [fine, setFine] = useState(false);
  useEffect(() => setFine(window.matchMedia("(pointer: fine)").matches), []);
  return fine;
}

function useIsMobile() {
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

// ---------- ambient 3D background: humans wearing masks, helping each other up ----------
// Stylized rather than photoreal (primitive geometry can only carry so much realism),
// but composed as a clear narrative: one figure supporting another who's struggling,
// a third holding a mask out to share — read as a small "citizens helping citizens"
// scene, matching the app's civic-action framing.
function EcoHologram3D({ mouseRef, fine, isMobile }) {
  const mountRef = useRef(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let renderer, scene, camera, raf, group;
    let disposed = false;

    try {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const w = mount.clientWidth, h = mount.clientHeight;
      const seg = isMobile ? 8 : 14; // lower poly count on phones

      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 100);
      camera.position.set(0, 2.3, isMobile ? 8.5 : 9.5);
      camera.lookAt(0, 1, 0);

      renderer = new THREE.WebGLRenderer({ antialias: !isMobile, alpha: true });
      renderer.setSize(w, h);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.25 : 2));
      mount.appendChild(renderer.domElement);

      scene.add(new THREE.AmbientLight(0x1e293b, 1.1));
      const key = new THREE.PointLight(0x34d399, 6, 20);
      key.position.set(2, 4, 4);
      scene.add(key);
      const rim = new THREE.PointLight(0x38bdf8, 3.5, 20);
      rim.position.set(-4, 2, -2);
      scene.add(rim);

      group = new THREE.Group();
      group.position.y = -0.6;
      scene.add(group);

      const holoMat = (color, opacity = 0.6) =>
        new THREE.MeshStandardMaterial({
          color, emissive: color, emissiveIntensity: 0.55,
          transparent: true, opacity, roughness: 0.4, metalness: 0.1,
        });
      const skinMat = holoMat(0xfcd9b8, 0.7);
      const maskMat = new THREE.MeshStandardMaterial({
        color: 0xe5e7eb, emissive: 0x64748b, emissiveIntensity: 0.3,
        transparent: true, opacity: 0.85, roughness: 0.6,
      });

      const ground = new THREE.Mesh(
        new THREE.CircleGeometry(4.2, isMobile ? 24 : 48),
        new THREE.MeshStandardMaterial({ color: 0x0f172a, transparent: true, opacity: 0.5, roughness: 1 })
      );
      ground.rotation.x = -Math.PI / 2;
      group.add(ground);

      for (let i = 1; i <= 3; i++) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(i * 1.2, i * 1.2 + 0.02, isMobile ? 24 : 48),
          new THREE.MeshBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.18, side: THREE.DoubleSide })
        );
        ring.rotation.x = -Math.PI / 2;
        group.add(ring);
      }

      // a more articulated stylized human: head, mask, torso, hip joint, two arms w/ shoulder+hand,
      // two legs. bendTorso lets us tilt someone forward as if supporting or leaning on another person.
      function makeHuman({ x, z, rotY = 0, color = 0x34d399, bendTorso = 0, armL = null, armR = null, scale = 1 }) {
        const fig = new THREE.Group();
        const clothMat = holoMat(color);

        const hip = new THREE.Group();
        hip.position.y = 0.55;
        fig.add(hip);

        const torsoGroup = new THREE.Group();
        torsoGroup.rotation.x = bendTorso;
        hip.add(torsoGroup);

        const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.75, seg), clothMat);
        torso.position.y = 0.42;
        torsoGroup.add(torso);

        const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 8), skinMat);
        neck.position.y = 0.83;
        torsoGroup.add(neck);

        const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, seg, seg), skinMat);
        head.position.y = 0.98;
        torsoGroup.add(head);

        // mask: a small rounded box across the lower half of the face
        const mask = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), maskMat);
        mask.position.set(0, 0.94, 0.14);
        mask.rotation.x = -0.25;
        torsoGroup.add(mask);
        const earStrapL = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.01, 6, 12, Math.PI), maskMat);
        earStrapL.position.set(-0.13, 0.98, 0.02);
        earStrapL.rotation.y = Math.PI / 2;
        torsoGroup.add(earStrapL);

        function makeArm({ raise = 0.3, forward = 0, sideways = 0, holdOut = false } = {}) {
          const shoulder = new THREE.Group();
          const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.055, 0.32, 8), clothMat);
          upper.position.y = -0.16;
          shoulder.add(upper);

          const elbow = new THREE.Group();
          elbow.position.y = -0.32;
          const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.3, 8), skinMat);
          lower.position.y = -0.15;
          elbow.add(lower);

          const hand = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), skinMat);
          hand.position.y = -0.32;
          elbow.add(hand);

          if (holdOut) {
            const heldMask = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8, 0, Math.PI * 2, 0, Math.PI * 0.6), maskMat);
            heldMask.position.y = -0.4;
            elbow.add(heldMask);
          }

          shoulder.add(elbow);
          shoulder.rotation.z = sideways;
          shoulder.rotation.x = forward;
          elbow.rotation.x = raise;
          return shoulder;
        }

        const armLeft = makeArm(armL || {});
        armLeft.position.set(-0.24, 0.78, 0);
        torsoGroup.add(armLeft);

        const armRight = makeArm(armR || {});
        armRight.position.set(0.24, 0.78, 0);
        torsoGroup.add(armRight);

        const legL = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.07, 0.55, 8), clothMat);
        legL.position.set(-0.1, -0.28, 0);
        const legR = legL.clone();
        legR.position.x = 0.1;
        hip.add(legL, legR);

        fig.add(hip);
        fig.position.set(x, 0, z);
        fig.rotation.y = rotY;
        fig.scale.setScalar(scale);
        fig.userData.phase = Math.random() * Math.PI * 2;
        return fig;
      }

      // Figure A: struggling — leaning forward, one hand near chest
      const figStruggling = makeHuman({
        x: -0.55, z: 0.1, rotY: 0.3, color: 0x64748b, bendTorso: 0.35,
        armL: { sideways: -0.6, forward: 0.4, raise: 0.9 },
        armR: { sideways: 0.9, forward: 0.1, raise: 0.3 },
      });

      // Figure B: supporting them — arm around figure A's shoulder, upright
      const figHelper = makeHuman({
        x: 0.35, z: -0.15, rotY: -0.5, color: 0x34d399, bendTorso: 0.12,
        armL: { sideways: -1.1, forward: 0.3, raise: 0.6 }, // reaching across to support
        armR: { sideways: 0.3, forward: 0, raise: 0.2 },
      });

      // Figure C: offering a spare mask outward
      const figGiver = makeHuman({
        x: 1.7, z: 0.9, rotY: -1.0, color: 0x38bdf8, bendTorso: 0,
        armL: { sideways: -0.2, forward: 0, raise: 0.2 },
        armR: { sideways: 1.0, forward: 0.5, raise: 0.4, holdOut: true },
      });

      group.add(figStruggling, figHelper, figGiver);

      const sapling = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.35, 6), holoMat(0x22c55e, 0.7));
      trunk.position.y = 0.18;
      const leaves = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 10), holoMat(0x34d399, 0.65));
      leaves.position.y = 0.42;
      sapling.add(trunk, leaves);
      sapling.position.set(-1.9, 0, -0.6);
      group.add(sapling);

      const figures = [figStruggling, figHelper, figGiver];

      function onResize() {
        const nw = mount.clientWidth, nh = mount.clientHeight;
        camera.aspect = nw / nh;
        camera.updateProjectionMatrix();
        renderer.setSize(nw, nh);
      }
      window.addEventListener("resize", onResize);

      function animate(now) {
        if (disposed) return;
        const t = now * 0.001;

        if (!reduceMotion) {
          group.rotation.y = Math.sin(t * 0.08) * 0.16;

          if (fine && !isMobile && mouseRef?.current?.x != null) {
            const nx = mouseRef.current.x / window.innerWidth - 0.5;
            const ny = mouseRef.current.y / window.innerHeight - 0.5;
            camera.position.x += (nx * 1.4 - camera.position.x) * 0.03;
            camera.position.y += (2.3 - ny * 0.8 - camera.position.y) * 0.03;
            camera.lookAt(0, 1, 0);
          }

          figures.forEach((f) => {
            f.position.y = Math.sin(t * 0.9 + f.userData.phase) * 0.025; // gentle breathing bob
          });
          const growth = 0.85 + Math.sin(t * 0.7) * 0.15;
          sapling.scale.setScalar(growth);
        }

        renderer.render(scene, camera);
        raf = requestAnimationFrame(animate);
      }
      raf = requestAnimationFrame(animate);

      return () => {
        disposed = true;
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", onResize);
        scene.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) obj.material.dispose();
        });
        renderer.dispose();
        if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
      };
    } catch (e) {
      console.warn("EcoHologram3D disabled:", e);
      setFailed(true);
    }
  }, [mouseRef, fine, isMobile]);

  if (failed) return null;
  return <div ref={mountRef} className="absolute inset-0 w-full h-full opacity-70" aria-hidden="true" />;
}

export default function LandingPage({ onEnter }) {
  const mouseRef = useRef({ x: null, y: null });
  const fine = useFinePointer();
  const isMobile = useIsMobile();
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
      className="relative min-h-screen w-full bg-gray-950 text-white overflow-hidden cursor-default"
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

      <EcoHologram3D mouseRef={mouseRef} fine={fine} isMobile={isMobile} />

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
