import React, { useEffect, useRef, useState, useCallback } from 'react';
import { rouletteAudio } from './RouletteAudio';

export const WHEEL_NUMBERS = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
  5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];

export const RED_SET = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

interface RouletteWheelProps {
  isSpinning: boolean;
  targetNumber: number | null;
  spinEndsAt?: number | null;
  spinDuration?: number;
  onSpinComplete?: (num: number) => void;
  size?: number;
  onManualSpinRequest?: () => void;
}

interface SpinTrajectory {
  startWheelAngle: number;
  startBallRelAngle: number;
  targetNumber: number;
  pocketAngleOnRotor: number;
  totalRelativeDelta: number;
  completed: boolean;
  pocketSoundPlayed: boolean;
  lastFretSector: number;
}

export const RouletteWheel: React.FC<RouletteWheelProps> = ({
  isSpinning,
  targetNumber,
  spinEndsAt,
  spinDuration = 9500,
  onSpinComplete,
  size = 320,
  onManualSpinRequest,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Wheel and ball continuous physics state
  const wheelAngleRef = useRef<number>(0);
  const ballAngleRef = useRef<number>(0);
  const ballRadiusRef = useRef<number>(0);

  // Animation timing
  const spinStartTimeRef = useRef<number | null>(null);
  const spinDurationRef = useRef<number>(spinDuration);
  const targetNumberRef = useRef<number | null>(targetNumber);
  const isSpinningRef = useRef<boolean>(isSpinning);

  // Trajectory calculation state
  const trajectoryRef = useRef<SpinTrajectory | null>(null);

  // Winning pocket highlight pulse
  const [settledNumber, setSettledNumber] = useState<number | null>(null);
  const [isHovered, setIsHovered] = useState<boolean>(false);

  // Keep targetNumberRef updated
  useEffect(() => {
    targetNumberRef.current = targetNumber;
    if (!isSpinningRef.current && targetNumber !== null) {
      setSettledNumber(targetNumber);
    }
    // If targetNumber arrives mid-spin and trajectory is active, smoothly update target pocket
    if (isSpinningRef.current && trajectoryRef.current && targetNumber !== null) {
      const idx = WHEEL_NUMBERS.indexOf(targetNumber);
      if (idx !== -1) {
        const sectorAngle = (2 * Math.PI) / 37;
        const pocketAngleOnRotor = idx * sectorAngle + sectorAngle / 2;
        const traj = trajectoryRef.current;
        traj.targetNumber = targetNumber;
        traj.pocketAngleOnRotor = pocketAngleOnRotor;
        // Recalculate total delta backwards so destination aligns with new target
        let diff = traj.startBallRelAngle - pocketAngleOnRotor;
        while (diff < 0) diff += 2 * Math.PI;
        traj.totalRelativeDelta = 2 * Math.PI * 8 + diff;
      }
    }
  }, [targetNumber]);

  useEffect(() => {
    spinDurationRef.current = spinDuration;
  }, [spinDuration]);

  // Spin start initialization function
  const setupSpinTrajectory = useCallback((targetNum: number) => {
    const numSectors = 37;
    const sectorAngle = (2 * Math.PI) / numSectors;
    const targetIdx = WHEEL_NUMBERS.indexOf(targetNum);
    const safeIdx = targetIdx !== -1 ? targetIdx : 0;
    const pocketAngleOnRotor = safeIdx * sectorAngle + sectorAngle / 2;

    // Normalize starting angles to [0, 2π)
    const currentWheel = ((wheelAngleRef.current % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const currentBall = ((ballAngleRef.current % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

    // Ball relative to wheel
    const startBallRel = ((currentBall - currentWheel) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);

    // Number of full counter-clockwise laps the ball makes relative to the wheel
    const LAPS = 8;
    let diff = startBallRel - pocketAngleOnRotor;
    while (diff < 0) diff += 2 * Math.PI;

    const totalRelativeDelta = 2 * Math.PI * LAPS + diff;

    trajectoryRef.current = {
      startWheelAngle: currentWheel,
      startBallRelAngle: startBallRel,
      targetNumber: targetNum,
      pocketAngleOnRotor,
      totalRelativeDelta,
      completed: false,
      pocketSoundPlayed: false,
      lastFretSector: -1,
    };
  }, []);

  // Handle spin trigger or multiplayer state updates
  useEffect(() => {
    const prevSpinning = isSpinningRef.current;
    isSpinningRef.current = isSpinning;

    if (isSpinning) {
      setSettledNumber(null);
      const now = Date.now();
      let duration = spinDurationRef.current;

      if (spinEndsAt && spinEndsAt > now) {
        const remaining = spinEndsAt - now;
        duration = Math.max(1000, remaining);
        spinDurationRef.current = duration;
        spinStartTimeRef.current = performance.now();
      } else {
        spinStartTimeRef.current = performance.now();
      }

      // Initialize trajectory
      const target = targetNumberRef.current ?? 0;
      setupSpinTrajectory(target);
    } else if (prevSpinning && !isSpinning) {
      // Finished spinning
      trajectoryRef.current = null;
    }
  }, [isSpinning, spinEndsAt, setupSpinTrajectory]);

  const handleCanvasClick = useCallback(() => {
    if (!isSpinning && onManualSpinRequest) {
      onManualSpinRequest();
    }
  }, [isSpinning, onManualSpinRequest]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let lastFrameTime = performance.now();

    const render = (currentTime: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (currentTime - lastFrameTime) / 1000));
      lastFrameTime = currentTime;

      const dpr = window.devicePixelRatio || 1;
      const width = size;
      const height = size;

      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      const cx = width / 2;
      const cy = height / 2;
      const outerR = Math.min(width, height) / 2 - 6;
      const innerWoodR = outerR * 0.92;
      const ballTrackR = outerR * 0.84;
      const pocketOuterR = outerR * 0.74;
      const pocketInnerR = outerR * 0.46;
      const centerTurretR = outerR * 0.42;

      const numSectors = 37;
      const sectorAngle = (2 * Math.PI) / numSectors;

      // Defensive check against NaN
      if (isNaN(wheelAngleRef.current)) wheelAngleRef.current = 0;
      if (isNaN(ballAngleRef.current)) ballAngleRef.current = 0;

      // ==========================================
      // PHYSICS & SMOOTH DECELERATION UPDATE
      // ==========================================
      if (isSpinningRef.current && spinStartTimeRef.current !== null && trajectoryRef.current) {
        const traj = trajectoryRef.current;
        const elapsed = Math.max(0, currentTime - spinStartTimeRef.current);
        const duration = Math.max(1000, spinDurationRef.current);
        const progress = Math.max(0, Math.min(1, elapsed / duration));

        // 1. Wheel Deceleration: starts fast (~4 rad/s) and decelerates gracefully to idle coast (~0.5 rad/s)
        const wheelEase = Math.pow(1 - progress, 1.5);
        const wheelSpeed = 0.5 + 4.2 * wheelEase; // rad/s
        wheelAngleRef.current = (wheelAngleRef.current + wheelSpeed * dt) % (2 * Math.PI);

        // 2. Ball Smooth Deceleration Curve E(progress)
        // High-order polynomial easing: starts with strong rolling speed, decelerates naturally,
        // and its velocity derivative E'(progress) approaches EXACTLY 0 at progress = 1.0.
        // E(p) = 1 - (1 - p)^3 * (1 + 1.5 * p)
        const pInv = 1 - progress;
        const ballEase = 1 - Math.pow(pInv, 3) * (1 + 1.5 * progress);

        // Relative angle of the ball to the wheel rotor
        let relAngle = traj.startBallRelAngle - traj.totalRelativeDelta * ballEase;

        // 3. Subtle realistic micro-damped settling wobble when ball rolls into the target pocket (Phase 4)
        if (progress >= 0.88 && progress < 0.98) {
          const settleProgress = (progress - 0.88) / 0.10;
          // Very gentle damped harmonic oscillation inside pocket (~1.5 degrees amplitude dying quickly to 0)
          const wobble =
            Math.sin(settleProgress * Math.PI * 4) * 0.025 * Math.exp(-settleProgress * 4.5);
          relAngle += wobble;
        }

        // Absolute ball angle in world coordinates:
        // By construction: at progress = 1, relAngle == traj.pocketAngleOnRotor!
        // This guarantees 100% mathematically continuous motion with ZERO sudden snapping or jump!
        ballAngleRef.current = ((wheelAngleRef.current + relAngle) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);

        // 4. Ball Radial Position (Smooth vertical height / track transitions)
        const targetPocketR = (pocketOuterR + pocketInnerR) / 2;
        let bRad = targetPocketR;

        if (progress < 0.62) {
          // Phase 1: High outer mahogany ball track
          bRad = ballTrackR;

          // Subtle track roll hum sound occasionally
          if (Math.random() < 0.06) {
            rouletteAudio.playFretBounceSound(0.25);
          }
        } else if (progress < 0.88) {
          // Phase 2: Inward spiral descent over deflectors and pocket frets
          const dropU = (progress - 0.62) / 0.26;
          // Smooth Hermite blend from ballTrackR down to targetPocketR
          const s = dropU * dropU * (3 - 2 * dropU);
          const baseR = ballTrackR - (ballTrackR - targetPocketR) * s;
          // Gentle fret bounces that start at 0 and end at 0
          const hop = Math.sin(dropU * Math.PI * 5) * 3.2 * (1 - dropU) * Math.sin(dropU * Math.PI);
          bRad = baseR + hop;

          // Sound: realistic fret clatter with decaying volume as speed drops
          const currentSector = Math.floor(
            (((ballAngleRef.current - wheelAngleRef.current) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI)) /
              sectorAngle
          );
          if (currentSector !== traj.lastFretSector) {
            traj.lastFretSector = currentSector;
            const volume = Math.max(0.12, 0.75 * (1 - dropU));
            rouletteAudio.playFretBounceSound(volume);
          }
        } else if (progress < 0.96) {
          // Phase 3: Rolling into the winning pocket with a tiny soft settle bounce
          const settleU = (progress - 0.88) / 0.08;
          const microHop = Math.sin(settleU * Math.PI) * 1.4 * (1 - settleU);
          bRad = targetPocketR + microHop;

          // Play solid pocket thud sound once
          if (!traj.pocketSoundPlayed && progress >= 0.92) {
            traj.pocketSoundPlayed = true;
            rouletteAudio.playBallPocketSound();
          }
        } else {
          // Phase 4: Perfectly resting at center of winning pocket
          bRad = targetPocketR;
        }

        ballRadiusRef.current = bRad;

        // 5. Spin Completion Handler
        if (!traj.completed && progress >= 0.98) {
          traj.completed = true;
          isSpinningRef.current = false;
          setSettledNumber(traj.targetNumber);
          if (onSpinComplete) {
            onSpinComplete(traj.targetNumber);
          }
        }
      } else {
        // ==========================================
        // IDLE STATE: Continuous Elegant Casino Rotation
        // The wheel never freezes - coasts smoothly at ~0.5 rad/s (~0.008 rad/frame)
        // ==========================================
        wheelAngleRef.current = (wheelAngleRef.current + 0.5 * dt) % (2 * Math.PI);

        // Ball is locked inside the settled winning pocket and moves seamlessly with the rotor
        const targetNum = settledNumber ?? targetNumberRef.current ?? 0;
        const targetIdx = WHEEL_NUMBERS.indexOf(targetNum);
        const safeIdx = targetIdx !== -1 ? targetIdx : 0;
        const pocketAngleOnRotor = safeIdx * sectorAngle + sectorAngle / 2;

        ballAngleRef.current = (wheelAngleRef.current + pocketAngleOnRotor) % (2 * Math.PI);
        ballRadiusRef.current = (pocketOuterR + pocketInnerR) / 2;
      }

      // ==========================================
      // DRAW WHEEL GRAPHICS
      // ==========================================

      // 1. Deep Shadow Beneath Outer Rim
      ctx.beginPath();
      ctx.arc(cx, cy, outerR + 2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
      ctx.shadowColor = '#000000';
      ctx.shadowBlur = 20;
      ctx.fill();
      ctx.shadowBlur = 0;

      // 2. Outer Mahogany Wood Bowl Rim with rich gradient
      const woodGrad = ctx.createRadialGradient(cx, cy, innerWoodR, cx, cy, outerR);
      woodGrad.addColorStop(0, '#3d160c');
      woodGrad.addColorStop(0.4, '#5e2314');
      woodGrad.addColorStop(0.75, '#2e0f08');
      woodGrad.addColorStop(1, '#180703');
      ctx.beginPath();
      ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
      ctx.fillStyle = woodGrad;
      ctx.fill();

      // Outer gold polished bezel rim
      ctx.beginPath();
      ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
      ctx.strokeStyle = '#eab308';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // Inner wood bezel ring
      ctx.beginPath();
      ctx.arc(cx, cy, innerWoodR, 0, Math.PI * 2);
      ctx.strokeStyle = '#854d0e';
      ctx.lineWidth = 2;
      ctx.stroke();

      // 3. Metallic Bronze Ball Track
      const trackGrad = ctx.createRadialGradient(cx, cy, pocketOuterR, cx, cy, innerWoodR);
      trackGrad.addColorStop(0, '#18181b');
      trackGrad.addColorStop(0.5, '#27272a');
      trackGrad.addColorStop(1, '#09090b');
      ctx.beginPath();
      ctx.arc(cx, cy, innerWoodR, 0, Math.PI * 2);
      ctx.fillStyle = trackGrad;
      ctx.fill();

      // 8 Diamond Chrome Deflector Studs around ball track
      for (let d = 0; d < 8; d++) {
        const dAngle = (d * Math.PI) / 4 + wheelAngleRef.current * 0.12;
        const dx = cx + Math.cos(dAngle) * (ballTrackR + 3);
        const dy = cy + Math.sin(dAngle) * (ballTrackR + 3);

        ctx.save();
        ctx.translate(dx, dy);
        ctx.rotate(dAngle);
        ctx.beginPath();
        ctx.moveTo(0, -3.5);
        ctx.lineTo(2.5, 0);
        ctx.lineTo(0, 3.5);
        ctx.lineTo(-2.5, 0);
        ctx.closePath();
        ctx.fillStyle = '#f8fafc';
        ctx.shadowColor = '#fbbf24';
        ctx.shadowBlur = 3;
        ctx.fill();
        ctx.restore();
      }

      // 4. ROTATING WHEEL ROTOR (Pockets, Frets, and Numbers)
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(wheelAngleRef.current);

      for (let i = 0; i < numSectors; i++) {
        const num = WHEEL_NUMBERS[i];
        const startAng = i * sectorAngle;
        const endAng = startAng + sectorAngle;
        const midAng = startAng + sectorAngle / 2;

        let fillColor = '#18181b'; // Black pocket
        if (num === 0) {
          fillColor = '#059669'; // Green 0
        } else if (RED_SET.has(num)) {
          fillColor = '#dc2626'; // Red pocket
        }

        // Highlight settled winning pocket
        const isWinningPocket = settledNumber === num;

        ctx.beginPath();
        ctx.arc(0, 0, pocketOuterR, startAng, endAng);
        ctx.arc(0, 0, pocketInnerR, endAng, startAng, true);
        ctx.closePath();
        ctx.fillStyle = isWinningPocket ? '#fbbf24' : fillColor;
        ctx.fill();

        // Metallic pocket fret border
        ctx.strokeStyle = isWinningPocket ? '#ffffff' : '#d4af37';
        ctx.lineWidth = isWinningPocket ? 1.8 : 0.8;
        ctx.stroke();

        // Radially upright pocket number text
        ctx.save();
        ctx.rotate(midAng);
        ctx.translate((pocketOuterR + pocketInnerR) / 2, 0);
        ctx.rotate(Math.PI / 2);

        ctx.font = `bold ${Math.round(outerR * 0.084)}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = isWinningPocket ? '#09090b' : '#ffffff';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
        ctx.shadowBlur = 2;
        ctx.fillText(num.toString(), 0, 0);
        ctx.restore();
      }

      // Gold ring separating pockets from center turret
      ctx.beginPath();
      ctx.arc(0, 0, pocketInnerR, 0, Math.PI * 2);
      ctx.strokeStyle = '#d4af37';
      ctx.lineWidth = 2.2;
      ctx.stroke();

      // 5. Center Polished Brass Turret
      const turretGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, centerTurretR);
      turretGrad.addColorStop(0, '#fef08a');
      turretGrad.addColorStop(0.3, '#eab308');
      turretGrad.addColorStop(0.7, '#78350f');
      turretGrad.addColorStop(1, '#451a03');

      ctx.beginPath();
      ctx.arc(0, 0, centerTurretR, 0, Math.PI * 2);
      ctx.fillStyle = turretGrad;
      ctx.fill();

      // 8 Brass Spokes
      for (let s = 0; s < 8; s++) {
        const sAng = (s * Math.PI) / 4;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(sAng) * centerTurretR, Math.sin(sAng) * centerTurretR);
        ctx.strokeStyle = '#fde047';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Center Chrome Finial Cone
      const coneGrad = ctx.createRadialGradient(-3, -3, 0, 0, 0, centerTurretR * 0.42);
      coneGrad.addColorStop(0, '#ffffff');
      coneGrad.addColorStop(0.4, '#e2e8f0');
      coneGrad.addColorStop(0.8, '#64748b');
      coneGrad.addColorStop(1, '#1e293b');

      ctx.beginPath();
      ctx.arc(0, 0, centerTurretR * 0.42, 0, Math.PI * 2);
      ctx.fillStyle = coneGrad;
      ctx.fill();
      ctx.strokeStyle = '#d4af37';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.restore(); // Restore wheel transform

      // ==========================================
      // 6. DRAW THE WHITE IVORY BALL
      // ==========================================
      const bRad = ballRadiusRef.current || (pocketOuterR + pocketInnerR) / 2;
      const bx = cx + Math.cos(ballAngleRef.current) * bRad;
      const by = cy + Math.sin(ballAngleRef.current) * bRad;
      const ballSize = Math.max(4.5, outerR * 0.046);

      // Realistic 3D dynamic drop shadow (shifts depending on elevation)
      const shadowDist = bRad > pocketOuterR ? 2.5 : 1.2;
      ctx.beginPath();
      ctx.arc(bx + shadowDist, by + shadowDist, ballSize, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.shadowColor = '#000000';
      ctx.shadowBlur = bRad > pocketOuterR ? 4 : 2;
      ctx.fill();
      ctx.shadowBlur = 0;

      // 3D Ivory ball with realistic specular gloss
      const ballGrad = ctx.createRadialGradient(
        bx - ballSize * 0.35,
        by - ballSize * 0.35,
        ballSize * 0.1,
        bx,
        by,
        ballSize
      );
      ballGrad.addColorStop(0, '#ffffff');
      ballGrad.addColorStop(0.25, '#f8fafc');
      ballGrad.addColorStop(0.7, '#e2e8f0');
      ballGrad.addColorStop(1, '#94a3b8');

      ctx.beginPath();
      ctx.arc(bx, by, ballSize, 0, Math.PI * 2);
      ctx.fillStyle = ballGrad;
      ctx.shadowColor = 'rgba(255, 255, 255, 0.85)';
      ctx.shadowBlur = isSpinningRef.current ? 4 : 2;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Golden halo spotlight when settled on a winning number
      if (settledNumber !== null) {
        const pulse = 1 + 0.18 * Math.sin(currentTime * 0.008);
        ctx.beginPath();
        ctx.arc(bx, by, (ballSize + 3.5) * pulse, 0, Math.PI * 2);
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 2.5;
        ctx.shadowColor = '#f59e0b';
        ctx.shadowBlur = 10;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      ctx.restore();

      animFrameRef.current = requestAnimationFrame(render);
    };

    animFrameRef.current = requestAnimationFrame(render);

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [size, onSpinComplete]);

  return (
    <div className="relative flex flex-col items-center justify-center select-none">
      <div
        className="relative rounded-full shadow-[0_0_35px_rgba(0,0,0,0.85)] border border-amber-500/20 group cursor-pointer"
        style={{ width: size, height: size }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={handleCanvasClick}
        title={!isSpinning ? 'Click wheel to test spin' : 'Roulette Wheel Spinning...'}
      >
        <canvas
          ref={canvasRef}
          style={{ width: size, height: size }}
          className="rounded-full"
        />

        {/* Top Rim Center Target Indicator Needle (at 12 o'clock) */}
        <div className="absolute top-1 left-1/2 -translate-x-1/2 w-3 h-3 flex items-center justify-center pointer-events-none">
          <div className="w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[8px] border-t-amber-400 drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]" />
        </div>

        {/* Settled Number Spotlight Banner */}
        {settledNumber !== null && !isSpinning && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-zinc-950/90 backdrop-blur-sm border border-amber-400/80 px-3 py-1 rounded-xl shadow-2xl flex items-center gap-2 animate-bounce">
              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center font-black text-xs text-white shadow-md ${
                  settledNumber === 0
                    ? 'bg-emerald-600'
                    : RED_SET.has(settledNumber)
                    ? 'bg-red-600'
                    : 'bg-zinc-900 border border-zinc-700'
                }`}
              >
                {settledNumber}
              </span>
              <span className="text-[11px] font-bold text-amber-300 font-mono">
                {settledNumber === 0
                  ? 'ZERO'
                  : `${RED_SET.has(settledNumber) ? 'RED' : 'BLACK'} · ${
                      settledNumber % 2 === 0 ? 'EVEN' : 'ODD'
                    }`}
              </span>
            </div>
          </div>
        )}

        {/* Spinning Status Overlay Pill */}
        {isSpinning && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 pointer-events-none">
            <div className="bg-amber-950/80 border border-amber-500/50 backdrop-blur-sm px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold text-amber-300 shadow-lg flex items-center gap-1.5 animate-pulse">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span>
              <span>WHEEL SPINNING</span>
            </div>
          </div>
        )}

        {/* Interactive Click to Test Spin Hint on Hover (when not spinning) */}
        {!isSpinning && isHovered && onManualSpinRequest && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 pointer-events-none">
            <div className="bg-zinc-900/90 border border-amber-400/50 backdrop-blur-sm px-2 py-0.5 rounded-full text-[9px] font-semibold text-amber-300 shadow-md">
              🌀 Click to Test Spin
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
