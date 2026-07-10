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
function BlobMaskBackground({ mouseRef }) {
  const containerRef = useRef(null);
  const mainBlobRef = useRef(null);
  const trailContainerRef = useRef(null);
  const cursorVisualRef = useRef(null);
  const requestRef = useRef(null);

  useEffect(() => {
    const mainBlob = mainBlobRef.current;
    const trailContainer = trailContainerRef.current;
    const cursorVisual = cursorVisualRef.current;

    let currentX = window.innerWidth / 2;
    let currentY = window.innerHeight / 2;
    let lastX = currentX;
    let lastY = currentY;
    let time = 0;
    let speed = 0;

    const trails = [];
    const trailCount = 15;

    if (trailContainer) {
      trailContainer.innerHTML = '';
      for (let i = 0; i < trailCount; i++) {
        const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        c.setAttribute("r", "0");
        c.setAttribute("fill", "black");
        trailContainer.appendChild(c);
        trails.push({ el: c, x: 0, y: 0, r: 0, active: false, life: 0 });
      }
    }

    function animate() {
      time += 0.015;

      const rect = containerRef.current?.getBoundingClientRect();
      let rawX = mouseRef.current.x;
      let rawY = mouseRef.current.y;
      
      let mouseX = window.innerWidth / 2;
      let mouseY = window.innerHeight / 2;
      
      if (rect) {
        if (rawX !== null && rawY !== null) {
          mouseX = rawX - rect.left;
          mouseY = rawY - rect.top;
        } else {
          mouseX = rect.width / 2;
          mouseY = rect.height / 2;
        }
      }

      currentX += (mouseX - currentX) * 0.12;
      currentY += (mouseY - currentY) * 0.12;

      const dx = mouseX - lastX;
      const dy = mouseY - lastY;
      speed = Math.sqrt(dx * dx + dy * dy);
      lastX = mouseX;
      lastY = mouseY;

      const isMobileSize = window.innerWidth < 768;
      const baseRadius = isMobileSize ? 90 : 160;
      const wobble = Math.sin(time * 3) * 8;
      const dynamicRadius = baseRadius + speed * 0.4 + wobble;

      if (mainBlob) {
        mainBlob.setAttribute("cx", currentX);
        mainBlob.setAttribute("cy", currentY);
        mainBlob.setAttribute("r", dynamicRadius);
      }

      if (cursorVisual) {
        cursorVisual.style.transform = `translate(${currentX}px, ${currentY}px) scale(${1 + speed * 0.003})`;
      }

      trails.forEach((t) => {
        if (speed > 8 && !t.active && Math.random() > 0.6) {
          t.active = true;
          t.x = currentX;
          t.y = currentY;
          t.r = dynamicRadius * 0.7;
          t.life = 1.0;
        }

        if (t.active) {
          t.life -= 0.025;
          t.r *= 0.95;
          t.el.setAttribute("cx", t.x);
          t.el.setAttribute("cy", t.y);
          t.el.setAttribute("r", Math.max(0, t.r));
          t.el.setAttribute("opacity", t.life);

          if (t.life <= 0) {
            t.active = false;
            t.el.setAttribute("r", "0");
          }
        }
      });

      requestRef.current = requestAnimationFrame(animate);
    }

    requestRef.current = requestAnimationFrame(animate);

    // Mouse tracking
    const onMouseMove = (e) => {
      mouseRef.current.x = e.clientX;
      mouseRef.current.y = e.clientY;
    };
    const onMouseLeave = () => {
      mouseRef.current.x = null;
      mouseRef.current.y = null;
    };
    // Touch tracking for mobile
    const onTouchMove = (e) => {
      if (!e.touches || !e.touches[0]) return;
      mouseRef.current.x = e.touches[0].clientX;
      mouseRef.current.y = e.touches[0].clientY;
    };
    const onTouchEnd = () => {
      mouseRef.current.x = null;
      mouseRef.current.y = null;
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseleave", onMouseLeave);
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("touchcancel", onTouchEnd);

    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseleave", onMouseLeave);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [mouseRef]);

  return (
    <div 
      ref={containerRef}
      className="absolute w-[85vw] h-[50vh] max-w-[380px] max-h-[480px] md:w-full md:h-full md:max-w-none md:max-h-none rounded-2xl md:rounded-none overflow-hidden border border-gray-800/80 md:border-none shadow-2xl md:shadow-none top-[43%] md:top-0 left-1/2 md:left-0 -translate-x-1/2 md:translate-x-0 -translate-y-1/2 md:translate-y-0 z-0"
    >
      <style>{`
        .reveal-container { clip-path: url(#blob-mask); }
      `}</style>
      
      {/* Dark navy background — matches the app's deep blue colour scheme */}
      <div className="absolute inset-0 z-0" style={{ backgroundColor: '#060e1d' }} />

      {/* Base Layer: grayscale man — luminosity blend makes grey photo bg adopt the dark navy hue */}
      <div className="absolute inset-0 z-0">
        <img
          src="https://vgbujcuwptvheqijyjbe.supabase.co/storage/v1/object/public/hmac-uploads/uploads/a985c5f1-0f13-4cee-b02e-104026005870/1783665424315-b1894727/Gemini_Generated_Image_m5sxj0m5sxj0m5sx.png"
          className="w-full h-full object-cover"
          style={{ filter: 'grayscale(100%) brightness(0.55)', mixBlendMode: 'luminosity', opacity: 0.85 }}
          alt="Base Image"
        />
      </div>

      {/* Reveal Layer: full-color man, clipped to blob cursor shape */}
      <div className="reveal-container absolute inset-0 z-0 pointer-events-none" style={{ backgroundColor: '#060e1d' }}>
        <img
          src="https://vgbujcuwptvheqijyjbe.supabase.co/storage/v1/object/public/hmac-uploads/uploads/a985c5f1-0f13-4cee-b02e-104026005870/1783665428843-5ae19fa9/Gemini_Generated_Image_s79aous79aous79a.png"
          className="w-full h-full object-cover"
          style={{ opacity: 0.95 }}
          alt="Reveal Image"
        />
      </div>

      {/* SVG Filters & Mask */}
      <svg width="0" height="0" className="absolute">
        <defs>
          <filter id="goo">
            <feGaussianBlur in="SourceGraphic" stdDeviation="12" result="blur" />
            <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 35 -15" result="goo" />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
          <clipPath id="blob-mask" clipPathUnits="userSpaceOnUse">
            <circle ref={mainBlobRef} cx="0" cy="0" r="160" />
            <g ref={trailContainerRef}></g>
          </clipPath>
        </defs>
      </svg>

      {/* Visual Blob Cursor */}
      <div
        ref={cursorVisualRef}
        className="absolute top-0 left-0 w-[320px] h-[320px] -ml-[160px] -mt-[160px] rounded-full border border-white/30 pointer-events-none z-10 mix-blend-difference hidden md:block"
      ></div>
    </div>
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
      className="relative min-h-screen w-full text-white overflow-hidden"
      style={{ backgroundColor: '#060e1d', paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
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

      {/* Blob reveal background — man with respirator mask */}
      <BlobMaskBackground mouseRef={mouseRef} />

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

        <main ref={heroRef} className="flex-1 flex flex-col items-center justify-center text-center px-5 sm:px-6 -mt-6 sm:-mt-8 will-change-transform max-w-4xl mx-auto z-20" style={{ pointerEvents: 'none' }}>
          <div style={{ pointerEvents: 'auto' }}>
            <p className="text-[10px] sm:text-xs uppercase tracking-[0.2em] text-emerald-400/90 font-semibold mb-3 sm:mb-4 drop-shadow-md">
              Hyperlocal pollution, made visible
            </p>
            <h1 className="text-3xl sm:text-6xl font-bold tracking-tight max-w-3xl leading-[1.08] sm:leading-[1.05] drop-shadow-xl shadow-black">
              Every scattered signal,
              <br />
              <span className="shimmer-text text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-blue-400 to-emerald-400">
                one clear picture.
              </span>
            </h1>
            <p className="mt-5 sm:mt-6 max-w-xl mx-auto text-gray-200 text-sm sm:text-base leading-relaxed drop-shadow-md shadow-black font-medium">
              A garbage fire, a smog trap at a junction, a dust cloud from a site —
              AirWatch turns citizen photos and live sensor data into hotspots
              authorities can act on, before the air gets worse.
            </p>

            <MagneticButton onEnter={onEnter} fine={fine} />
            <p className="mt-4 text-[11px] text-gray-400 drop-shadow-md">
              {isMobile ? "Touch and drag to reveal the man behind the pollution." : "Move your cursor to reveal the man behind the pollution."}
            </p>
          </div>
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
