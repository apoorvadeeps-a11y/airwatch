import React, { useEffect, useRef } from "react";

export default function Portfolio() {
  const containerRef = useRef(null);
  const mainBlobRef = useRef(null);
  const trailContainerRef = useRef(null);
  const cursorVisualRef = useRef(null);
  const wavePathRef = useRef(null);
  const parallaxRefs = useRef([]);
  const requestRef = useRef(null);

  useEffect(() => {
    if (!document.getElementById("iconify-script")) {
      const script = document.createElement("script");
      script.id = "iconify-script";
      script.src = "https://code.iconify.design/iconify-icon/1.0.7/iconify-icon.min.js";
      document.head.appendChild(script);
    }
  }, []);

  useEffect(() => {
    const mainBlob = mainBlobRef.current;
    const trailContainer = trailContainerRef.current;
    const cursorVisual = cursorVisualRef.current;
    const wavePath = wavePathRef.current;
    const parallaxElements = parallaxRefs.current;

    let mouseX = window.innerWidth / 2;
    let mouseY = window.innerHeight / 2;
    let currentX = mouseX;
    let currentY = mouseY;
    let lastX = mouseX;
    let lastY = mouseY;
    let time = 0;
    let speed = 0;

    const trails = [];
    const trailCount = 15;

    // Initialize trail elements in SVG
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

    const onMouseMove = (e) => {
      // Offset by the container position if not full screen, but here we assume full screen overlay or local coords
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        mouseX = e.clientX - rect.left;
        mouseY = e.clientY - rect.top;
      } else {
        mouseX = e.clientX;
        mouseY = e.clientY;
      }

      // Parallax application
      parallaxElements.forEach((el) => {
        if (!el) return;
        const depth = parseFloat(el.getAttribute("data-parallax") || "-0.02");
        const moveX = (window.innerWidth / 2 - e.clientX) * depth;
        const moveY = (window.innerHeight / 2 - e.clientY) * depth;
        el.style.transform = `translate(${moveX}px, ${moveY}px)`;
      });
    };

    window.addEventListener("mousemove", onMouseMove);

    function animate() {
      time += 0.015;

      // Smooth interpolation for blob lag
      currentX += (mouseX - currentX) * 0.12;
      currentY += (mouseY - currentY) * 0.12;

      // Calculate instantaneous speed
      const dx = mouseX - lastX;
      const dy = mouseY - lastY;
      speed = Math.sqrt(dx * dx + dy * dy);
      lastX = mouseX;
      lastY = mouseY;

      // Organic scale pulse and deformation based on speed
      const baseRadius = 160;
      const wobble = Math.sin(time * 3) * 8;
      const dynamicRadius = baseRadius + speed * 0.4 + wobble;

      if (mainBlob) {
        mainBlob.setAttribute("cx", currentX);
        mainBlob.setAttribute("cy", currentY);
        mainBlob.setAttribute("r", dynamicRadius);
      }

      // Update visual cursor ring
      if (cursorVisual) {
        cursorVisual.style.transform = `translate(${currentX}px, ${currentY}px) scale(${1 + speed * 0.003})`;
      }

      // Trail Logic
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

      // Background Wave Deformation
      if (wavePath && containerRef.current) {
        const height = containerRef.current.clientHeight;
        const width = containerRef.current.clientWidth;
        let d = `M 0 ${height / 2}`;
        const segments = 25;
        const segWidth = width / segments;
        for (let i = 0; i <= segments; i++) {
          const x = i * segWidth;
          const dist = Math.abs(x - mouseX);
          const mouseInfluence = Math.max(0, 1 - dist / 600);
          const y = height / 2 + Math.sin(i * 0.3 + time) * 30 + mouseInfluence * (mouseY - height / 2) * 0.4;
          d += ` L ${x} ${y}`;
        }
        wavePath.setAttribute("d", d);
      }

      requestRef.current = requestAnimationFrame(animate);
    }

    requestRef.current = requestAnimationFrame(animate);

    const onContextMenu = (e) => e.preventDefault();
    const container = containerRef.current;
    if (container) {
      container.addEventListener("contextmenu", onContextMenu);
    }

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      if (container) container.removeEventListener("contextmenu", onContextMenu);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, []);

  return (
    <div ref={containerRef} className="relative w-full h-[80vh] overflow-hidden bg-[#1a2a4a] rounded-xl selection:bg-white selection:text-black shadow-2xl" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <style>{`
        .reveal-container { clip-path: url(#blob-mask); }
        .parallax { transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
        .mix-difference { mix-blend-mode: difference; }
        .social-icon { transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
        .social-icon:hover { transform: scale(1.2) rotate(8deg); }
      `}</style>
      
      {/* Background Dynamic Wave */}
      <svg className="absolute inset-0 w-full h-full z-0 opacity-15 pointer-events-none" xmlns="http://www.w3.org/2000/svg">
        <path ref={wavePathRef} fill="none" stroke="white" strokeOpacity="0.2" strokeWidth="0.5" d="" />
      </svg>

      {/* Base Layer: Masked Image */}
      <div className="absolute inset-0 z-10">
        <img
          src="https://vgbujcuwptvheqijyjbe.supabase.co/storage/v1/object/public/hmac-uploads/uploads/a985c5f1-0f13-4cee-b02e-104026005870/1783665424315-b1894727/Gemini_Generated_Image_m5sxj0m5sxj0m5sx.png"
          className="w-full h-full object-cover grayscale opacity-80 mix-blend-soft-light"
          alt="Portrait Masked"
        />
      </div>

      {/* Reveal Layer: Clean Image (Visible via Mask) */}
      <div className="reveal-container absolute inset-0 z-20 pointer-events-none">
        <img
          src="https://vgbujcuwptvheqijyjbe.supabase.co/storage/v1/object/public/hmac-uploads/uploads/a985c5f1-0f13-4cee-b02e-104026005870/1783665428843-5ae19fa9/Gemini_Generated_Image_s79aous79aous79a.png"
          className="w-full h-full object-cover"
          alt="Portrait Reveal"
        />
      </div>

      {/* Overlay UI Layer */}
      <div className="absolute inset-0 z-40 flex flex-col justify-between p-12 mix-difference pointer-events-none">
        <header className="flex justify-between items-start">
          <h2 className="text-white text-4xl font-bold font-serif">Sarah Mitchell</h2>
        </header>

        <footer className="flex justify-end items-end">
          <div
            className="flex space-x-8 parallax pointer-events-auto"
            data-parallax="-0.02"
            ref={(el) => { if (el && !parallaxRefs.current.includes(el)) parallaxRefs.current.push(el); }}
          >
            <a href="#instagram" className="social-icon text-white text-3xl"><iconify-icon icon="ri:instagram-line"></iconify-icon></a>
            <a href="#youtube" className="social-icon text-white text-3xl"><iconify-icon icon="ri:youtube-line"></iconify-icon></a>
            <a href="#linkedin" className="social-icon text-white text-3xl"><iconify-icon icon="ri:linkedin-line"></iconify-icon></a>
          </div>
        </footer>
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

      {/* Visual Blob Cursor (Matches Mask for clarity) */}
      <div
        ref={cursorVisualRef}
        className="absolute top-0 left-0 w-[320px] h-[320px] -ml-[160px] -mt-[160px] rounded-full border border-white/30 pointer-events-none z-50 mix-difference hidden md:block"
      ></div>
    </div>
  );
}
