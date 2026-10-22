import React, { useRef, useEffect } from 'react';

interface AviatorCanvasProps {
  status: 'WAITING' | 'RUNNING' | 'CRASHED' | 'SETTLED';
  multiplier: number;
}

interface Star {
  x: number;
  y: number;
  length: number;
  speed: number;
  opacity: number;
  size: number;
}

interface CrashParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  alpha: number;
  decay: number;
  spin: number;
  spinSpeed: number;
}

export const AviatorCanvas: React.FC<AviatorCanvasProps> = ({ status, multiplier }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isCrashResult = status === 'CRASHED' || status === 'SETTLED';

  // References to preserve state across render frames
  const starsRef = useRef<Star[]>([]);
  const crashParticlesRef = useRef<CrashParticle[]>([]);
  const crashAnimationProgressRef = useRef<number>(0);
  const lastStatusRef = useRef<string>(status);
  const planePosRef = useRef<{ x: number; y: number; angle: number }>({ x: 14, y: 275, angle: -0.1 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Initialize stars if not initialized
    if (starsRef.current.length === 0) {
      const starList: Star[] = [];
      const count = 45;
      for (let i = 0; i < count; i++) {
        starList.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          length: 1 + Math.random() * 3,
          speed: 1 + Math.random() * 2.5,
          opacity: 0.2 + Math.random() * 0.7,
          size: 1 + Math.random() * 1.5,
        });
      }
      starsRef.current = starList;
    }

    // Trigger crash animation particles on status switch to CRASHED
    if (isCrashResult && lastStatusRef.current !== 'CRASHED' && lastStatusRef.current !== 'SETTLED') {
      const origin = planePosRef.current;
      const particles: CrashParticle[] = [];
      const colors = ['#ef4444', '#dc2626', '#f97316', '#fbbf24', '#ffffff', '#7f1d1d'];
      for (let i = 0; i < 40; i++) {
        const speed = 2 + Math.random() * 7;
        const angle = Math.random() * Math.PI * 2;
        particles.push({
          x: origin.x,
          y: origin.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          color: colors[Math.floor(Math.random() * colors.length)],
          size: 2.5 + Math.random() * 4.5,
          alpha: 1,
          decay: 0.015 + Math.random() * 0.025,
          spin: Math.random() * Math.PI * 2,
          spinSpeed: (Math.random() - 0.5) * 0.3,
        });
      }
      crashParticlesRef.current = particles;
      crashAnimationProgressRef.current = 0;
    } else if (status === 'WAITING') {
      crashParticlesRef.current = [];
      crashAnimationProgressRef.current = 0;
    }
    lastStatusRef.current = status;

    let animationFrameId: number;
    let particleOffset = 0;

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;

      // 1. Dark Space Background
      ctx.clearRect(0, 0, width, height);
      const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
      bgGrad.addColorStop(0, '#06070a');
      bgGrad.addColorStop(0.6, '#0b0c13');
      bgGrad.addColorStop(1, '#020306');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);

      // 2. Stars Moving Animation (Speed scales up as flight multiplier increases)
      // When multiplier goes high, stars streak leftwards rapidly giving sensation of supersonic speed
      const speedMultiplier = status === 'RUNNING' 
        ? Math.min(1 + (multiplier - 1.0) * 1.8, 12)
        : isCrashResult
        ? 0.5
        : 0.8;

      starsRef.current.forEach((star) => {
        // Move star to the left to simulate rightward flight
        star.x -= star.speed * speedMultiplier;
        if (star.x < -10) {
          star.x = width + Math.random() * 15;
          star.y = Math.random() * height;
        }

        // Streak length stretches with velocity
        const streakLength = status === 'RUNNING' ? Math.max(star.length, star.speed * speedMultiplier * 1.6) : star.length;

        ctx.strokeStyle = `rgba(255, 255, 255, ${star.opacity})`;
        ctx.lineWidth = star.size;
        ctx.beginPath();
        ctx.moveTo(star.x, star.y);
        ctx.lineTo(star.x + streakLength, star.y);
        ctx.stroke();

        // Little glow on fast stars
        if (speedMultiplier > 3) {
          ctx.fillStyle = `rgba(217, 249, 157, ${star.opacity * 0.4})`;
          ctx.fillRect(star.x, star.y - 0.5, 2, 2);
        }
      });

      // Subtle Grid / Coordinate lines for realistic Aviator cockpit radar
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
      ctx.lineWidth = 1;
      const gridSize = 28;
      for (let x = 0; x < width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      particleOffset += 0.6;

      // 3. Fixed Starting Point at Boundary (x = 0) & Smooth Flight Path to Ending Point
      // As requested: Flight originates directly from the starting boundary (x = 0) and lower down
      const startX = 0; // Exactly at the left boundary of the screen
      const startY = height * 0.88; // Lower runway baseline height near the bottom
      const maxEndX = width - 42;
      const maxEndY = 38; // Sky peak near top right

      // Boundary runway starting marker (draw from 0 boundary)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, startY);
      ctx.lineTo(status === 'RUNNING' || isCrashResult ? Math.max(planePosRef.current.x, 32) : 48, startY);
      ctx.stroke();

      // Runway guideline from 0 boundary
      ctx.strokeStyle = 'rgba(234, 179, 8, 0.3)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, startY);
      ctx.lineTo(status === 'RUNNING' || isCrashResult ? Math.max(planePosRef.current.x, 32) : 48, startY);
      ctx.stroke();
      ctx.setLineDash([]);

      if (status === 'RUNNING' || isCrashResult) {
        // Normalized progress smoothly maps multiplier (1.00x -> 10.00x+) into full trajectory
        const norm = Math.min(Math.max((multiplier - 1.0) / 9.0, 0), 1.0);
        
        // Aerodynamic flight path: smoothly takes off forward from boundary x=0 and curves into upper right
        const progressX = Math.min(Math.pow(norm, 0.72), 1.0);
        const progressY = Math.min(Math.pow(norm, 1.15), 1.0);

        // Plane starts with tail at the boundary (14px) and travels to maxEndX
        const initialPlaneX = 14;
        const currentX = initialPlaneX + (maxEndX - initialPlaneX) * progressX;
        const currentY = startY - (startY - maxEndY) * progressY;

        // Smooth control points for natural upward aerodynamic arc starting from boundary
        const controlX = currentX * 0.48;
        const controlY = startY + (currentY - startY) * 0.12;
        
        // Compute tangent angle for plane nose orientation
        const tangentDx = Math.max(2 * (1 - progressX) * controlX + 2 * progressX * (currentX - controlX), 0.1);
        const tangentDy = 2 * (1 - progressY) * (controlY - startY) + 2 * progressY * (currentY - controlY);
        const climbAngle = Math.min(Math.max(Math.atan2(tangentDy, tangentDx), -0.46), -0.06);

        planePosRef.current = { x: currentX, y: currentY, angle: climbAngle };

        // 4. Draw Trajectory Glow Curve & Area (originates directly from boundary 0)
        const fillGrad = ctx.createLinearGradient(0, currentY, 0, height);
        if (isCrashResult) {
          fillGrad.addColorStop(0, 'rgba(239, 68, 68, 0.22)');
          fillGrad.addColorStop(1, 'rgba(239, 68, 68, 0.0)');
        } else {
          fillGrad.addColorStop(0, 'rgba(239, 68, 68, 0.32)');
          fillGrad.addColorStop(0.5, 'rgba(234, 179, 8, 0.12)');
          fillGrad.addColorStop(1, 'rgba(234, 179, 8, 0.0)');
        }

        ctx.fillStyle = fillGrad;
        ctx.beginPath();
        ctx.moveTo(0, height);
        ctx.lineTo(0, startY);
        ctx.quadraticCurveTo(controlX, controlY, currentX, currentY);
        ctx.lineTo(currentX, height);
        ctx.lineTo(0, height);
        ctx.closePath();
        ctx.fill();

        // Trajectory Outline (Glowing Aviator Neon Red Line directly from boundary 0)
        ctx.beginPath();
        ctx.moveTo(0, startY);
        ctx.quadraticCurveTo(controlX, controlY, currentX, currentY);
        ctx.strokeStyle = isCrashResult ? '#ef4444' : '#f43f5e';
        ctx.lineWidth = 3;
        ctx.shadowColor = isCrashResult ? 'rgba(239, 68, 68, 0.9)' : 'rgba(244, 63, 94, 0.85)';
        ctx.shadowBlur = 10;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // 5. Plane Rendering or Crash Explosion Animation
        if (status === 'RUNNING') {
          // Draw Aircraft
          ctx.save();
          ctx.translate(currentX, currentY);
          ctx.rotate(climbAngle);

          // Jet Exhaust Flame
          const flameFlicker = (Math.sin(particleOffset * 2.5) + 1) * 3;
          const flameLength = 12 + flameFlicker + (multiplier > 3 ? 8 : 0);
          const flameGrad = ctx.createLinearGradient(0, 0, -flameLength, 0);
          flameGrad.addColorStop(0, '#ffffff');
          flameGrad.addColorStop(0.3, '#fbbf24');
          flameGrad.addColorStop(0.8, '#f97316');
          flameGrad.addColorStop(1, 'rgba(239, 68, 68, 0)');

          ctx.fillStyle = flameGrad;
          ctx.beginPath();
          ctx.moveTo(-11, -3);
          ctx.lineTo(-11 - flameLength, 0);
          ctx.lineTo(-11, 3);
          ctx.closePath();
          ctx.fill();

          // Jet Body (Sleek Aviator Red Jet)
          ctx.fillStyle = '#e11d48';
          ctx.beginPath();
          ctx.ellipse(0, 0, 14, 4.8, 0, 0, Math.PI * 2);
          ctx.fill();

          // Cockpit Glass
          ctx.fillStyle = '#38bdf8';
          ctx.beginPath();
          ctx.arc(4.5, -2, 2.4, 0, Math.PI * 2);
          ctx.fill();

          // Upper Wing
          ctx.fillStyle = '#be123c';
          ctx.beginPath();
          ctx.moveTo(-3, -2);
          ctx.lineTo(-7, -11);
          ctx.lineTo(2.5, -2);
          ctx.closePath();
          ctx.fill();

          // Lower Wing
          ctx.beginPath();
          ctx.moveTo(-3, 2);
          ctx.lineTo(-7, 11);
          ctx.lineTo(2.5, 2);
          ctx.closePath();
          ctx.fill();

          // Tail Fin
          ctx.fillStyle = '#9f1239';
          ctx.beginPath();
          ctx.moveTo(-10, -2);
          ctx.lineTo(-14, -7);
          ctx.lineTo(-7, -2);
          ctx.closePath();
          ctx.fill();

          ctx.restore();
        } else if (isCrashResult) {
          // Crash Animation: Render Falling Debris & Flying Away Explosion
          crashAnimationProgressRef.current += 1;

          // 1) Render expanding shockwave ring
          const ringRadius = Math.min(crashAnimationProgressRef.current * 2.2, 55);
          const ringAlpha = Math.max(1 - crashAnimationProgressRef.current / 35, 0);
          if (ringAlpha > 0) {
            ctx.beginPath();
            ctx.arc(currentX, currentY, ringRadius, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(244, 63, 94, ${ringAlpha * 0.8})`;
            ctx.lineWidth = 3;
            ctx.shadowColor = 'rgba(239, 68, 68, 1)';
            ctx.shadowBlur = 12;
            ctx.stroke();
            ctx.shadowBlur = 0;
          }

          // 2) Core explosion fire burst
          if (crashAnimationProgressRef.current < 25) {
            const burstRadius = Math.max(18 - crashAnimationProgressRef.current * 0.6, 6);
            ctx.save();
            ctx.translate(currentX, currentY);
            ctx.fillStyle = 'rgba(251, 191, 36, 0.9)';
            ctx.beginPath();
            ctx.arc(0, 0, burstRadius, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = 'rgba(239, 68, 68, 0.7)';
            ctx.beginPath();
            ctx.arc(0, 0, burstRadius * 1.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }

          // 3) Update and render explosion particles & debris
          crashParticlesRef.current.forEach((p) => {
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.12; // gravity pull on debris
            p.alpha = Math.max(p.alpha - p.decay, 0);
            p.spin += p.spinSpeed;

            if (p.alpha > 0) {
              ctx.save();
              ctx.translate(p.x, p.y);
              ctx.rotate(p.spin);
              ctx.fillStyle = p.color;
              ctx.globalAlpha = p.alpha;
              ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
              ctx.restore();
            }
          });
          ctx.globalAlpha = 1.0;
        }
      } else if (status === 'WAITING') {
        // Parked plane ready at boundary origin lower down
        const parkedY = height * 0.88;
        const initialPlaneX = 14;
        planePosRef.current = { x: initialPlaneX, y: parkedY, angle: -0.1 };

        ctx.save();
        ctx.translate(initialPlaneX, parkedY);
        ctx.rotate(-0.1);

        // Jet Body
        ctx.fillStyle = '#e11d48';
        ctx.beginPath();
        ctx.ellipse(0, 0, 14, 4.8, 0, 0, Math.PI * 2);
        ctx.fill();

        // Cockpit Glass
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.arc(4.5, -2, 2.4, 0, Math.PI * 2);
        ctx.fill();

        // Upper Wing
        ctx.fillStyle = '#be123c';
        ctx.beginPath();
        ctx.moveTo(-3, -2);
        ctx.lineTo(-7, -11);
        ctx.lineTo(2.5, -2);
        ctx.closePath();
        ctx.fill();

        // Lower Wing
        ctx.beginPath();
        ctx.moveTo(-3, 2);
        ctx.lineTo(-7, 11);
        ctx.lineTo(2.5, 2);
        ctx.closePath();
        ctx.fill();

        // Tail Fin
        ctx.fillStyle = '#9f1239';
        ctx.beginPath();
        ctx.moveTo(-10, -2);
        ctx.lineTo(-14, -7);
        ctx.lineTo(-7, -2);
        ctx.closePath();
        ctx.fill();

        ctx.restore();
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [status, multiplier]);

  return (
    <div className="relative w-full aspect-[16/8.4] max-h-[180px] min-h-[145px] bg-zinc-950 rounded-xl overflow-hidden border border-zinc-800 shadow-md flex items-center justify-center">
      <canvas
        ref={canvasRef}
        width={600}
        height={315}
        className="w-full h-full object-cover"
      />

      {/* Center Digital Multiplier Display */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none">
        {status === 'RUNNING' && (
          <div className="text-center animate-pulse">
            <span className="font-mono text-3xl sm:text-4xl font-black tracking-tight text-white drop-shadow-[0_0_20px_rgba(244,63,94,0.85)]">
              {multiplier.toFixed(2)}x
            </span>
          </div>
        )}

        {isCrashResult && (
          <div className="text-center">
            <div className="text-rose-500 font-extrabold text-[10px] uppercase tracking-widest leading-none mb-0.5 animate-bounce">
              FLEW AWAY!
            </div>
            <span className="font-mono text-3xl sm:text-4xl font-black tracking-tight text-rose-500 drop-shadow-[0_0_18px_rgba(239,68,68,0.85)]">
              {multiplier.toFixed(2)}x
            </span>
          </div>
        )}

        {status === 'WAITING' && (
          <div className="text-center bg-zinc-900/90 backdrop-blur-md px-3 py-1.5 rounded-lg border border-rose-500/30 shadow-md mx-2">
            <div className="text-rose-400 font-bold text-[10px] uppercase tracking-wider mb-1 flex items-center justify-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-ping"></span>
              Waiting for Departure
            </div>
            <div className="w-28 h-1 bg-zinc-800 rounded-full overflow-hidden mx-auto">
              <div className="h-full bg-gradient-to-r from-rose-500 to-amber-400 rounded-full animate-pulse"></div>
            </div>
            <div className="text-[9px] text-zinc-400 mt-0.5 font-mono">
              Place your bets now...
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

