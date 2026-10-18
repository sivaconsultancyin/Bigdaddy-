import React, { useMemo } from 'react';
import { Sparkles, Trophy } from 'lucide-react';

interface CssDiceArenaProps {
  isRolling: boolean;
  rollValue: number | null; // 1 to 10
  won: boolean | null;
  status: 'BETTING' | 'ROLLING' | 'RESULT';
}

// Map a number 1 to 10 into 2 dice values [d1, d2]
function getDicePair(total: number | null): [number, number] {
  if (total === null) return [3, 4]; // Neutral resting state
  if (total === 1) return [1, 0]; // Special: 1 on main die, 0/star on second die
  if (total === 2) return [1, 1];
  if (total === 3) return [1, 2];
  if (total === 4) return [2, 2];
  if (total === 5) return [2, 3];
  if (total === 6) return [3, 3];
  if (total === 7) return [3, 4];
  if (total === 8) return [4, 4];
  if (total === 9) return [4, 5];
  if (total === 10) return [5, 5];
  return [3, 4];
}

// 3D rotations to bring a given face to the FRONT / TOP view
function getFaceRotation(face: number): { x: number; y: number } {
  switch (face) {
    case 1:
      return { x: 0, y: 0 };
    case 2:
      return { x: -90, y: 0 };
    case 3:
      return { x: 0, y: -90 };
    case 4:
      return { x: 0, y: 90 };
    case 5:
      return { x: 90, y: 0 };
    case 6:
      return { x: 180, y: 0 };
    default:
      return { x: 0, y: 0 };
  }
}

// Render pips on a dice face
const FacePips: React.FC<{ count: number; isStar?: boolean }> = ({ count, isStar }) => {
  if (isStar || count === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <span className="text-amber-500 text-lg font-black font-mono">★</span>
      </div>
    );
  }

  // 1 to 6 pips arrangement
  const pipColor = count === 1 ? 'bg-red-600 shadow-[0_0_4px_rgba(220,38,38,0.8)]' : 'bg-zinc-900';

  return (
    <div className="w-full h-full p-2 grid grid-cols-3 grid-rows-3 items-center justify-items-center">
      {/* Row 1 */}
      {count >= 4 || count === 2 || count === 3 ? (
        <span className={`w-2.5 h-2.5 rounded-full ${pipColor}`} />
      ) : <span />}
      <span />
      {count >= 4 || count === 2 || count === 3 ? (
        <span className={`w-2.5 h-2.5 rounded-full ${pipColor}`} />
      ) : <span />}

      {/* Row 2 */}
      {count === 6 ? <span className={`w-2.5 h-2.5 rounded-full ${pipColor}`} /> : <span />}
      {count === 1 || count === 3 || count === 5 ? (
        <span className={`w-3.5 h-3.5 rounded-full ${count === 1 ? 'bg-red-600 ring-2 ring-red-400' : pipColor}`} />
      ) : <span />}
      {count === 6 ? <span className={`w-2.5 h-2.5 rounded-full ${pipColor}`} /> : <span />}

      {/* Row 3 */}
      {count >= 4 ? <span className={`w-2.5 h-2.5 rounded-full ${pipColor}`} /> : <span />}
      <span />
      {count >= 4 ? <span className={`w-2.5 h-2.5 rounded-full ${pipColor}`} /> : <span />}
    </div>
  );
};

// 3D Die Cube Component
const DieCube: React.FC<{
  targetValue: number;
  isRolling: boolean;
  won: boolean | null;
  offsetDeg: number;
  rollClass: string;
}> = ({ targetValue, isRolling, won, offsetDeg, rollClass }) => {
  const { x, y } = useMemo(() => getFaceRotation(targetValue), [targetValue]);

  // Half the cube size (56px / 2 = 28px)
  const half = 28;

  const baseStyle: React.CSSProperties = {
    transform: isRolling
      ? undefined
      : `rotateX(${x + 10}deg) rotateY(${y - 15 + offsetDeg}deg) rotateZ(${offsetDeg * 0.5}deg)`,
    transition: isRolling ? 'none' : 'transform 0.85s cubic-bezier(0.18, 0.89, 0.32, 1.28)',
    transformStyle: 'preserve-3d',
  };

  const faceStyle = (transform: string): React.CSSProperties => ({
    position: 'absolute',
    width: '56px',
    height: '56px',
    borderRadius: '12px',
    background: 'linear-gradient(145deg, #ffffff, #f4f4f5, #e4e4e7)',
    boxShadow: won
      ? 'inset 0 0 10px rgba(16, 185, 129, 0.4), 0 4px 12px rgba(0,0,0,0.4)'
      : 'inset 0 0 8px rgba(0, 0, 0, 0.12), 0 4px 12px rgba(0,0,0,0.3)',
    border: won ? '2px solid #10b981' : '1.5px solid #d4d4d8',
    backfaceVisibility: 'hidden',
    transform,
  });

  return (
    <div className="relative flex flex-col items-center">
      {/* 3D Die Container */}
      <div
        className={`w-14 h-14 ${isRolling ? rollClass : 'animate-float'}`}
        style={baseStyle}
      >
        {/* Face 1: Front */}
        <div style={faceStyle(`translateZ(${half}px)`)}>
          <FacePips count={targetValue === 0 ? 0 : 1} isStar={targetValue === 0} />
        </div>
        {/* Face 6: Back */}
        <div style={faceStyle(`rotateX(180deg) translateZ(${half}px)`)}>
          <FacePips count={6} />
        </div>
        {/* Face 3: Right */}
        <div style={faceStyle(`rotateY(90deg) translateZ(${half}px)`)}>
          <FacePips count={3} />
        </div>
        {/* Face 4: Left */}
        <div style={faceStyle(`rotateY(-90deg) translateZ(${half}px)`)}>
          <FacePips count={4} />
        </div>
        {/* Face 5: Top */}
        <div style={faceStyle(`rotateX(90deg) translateZ(${half}px)`)}>
          <FacePips count={5} />
        </div>
        {/* Face 2: Bottom */}
        <div style={faceStyle(`rotateX(-90deg) translateZ(${half}px)`)}>
          <FacePips count={2} />
        </div>
      </div>

      {/* Dynamic Floor Shadow */}
      <div
        className={`w-12 h-3.5 mt-4 rounded-full bg-black/60 blur-sm transition-all duration-300 ${
          isRolling ? 'scale-75 opacity-50' : 'scale-100 opacity-80'
        }`}
      />
    </div>
  );
};

export const CssDiceArena: React.FC<CssDiceArenaProps> = ({ isRolling, rollValue, won, status }) => {
  const [d1, d2] = useMemo(() => getDicePair(rollValue), [rollValue]);

  return (
    <div className="w-full relative overflow-hidden rounded-2xl border border-amber-500/30 bg-gradient-to-b from-zinc-950 via-zinc-900 to-black p-4 sm:p-6 shadow-2xl flex flex-col items-center justify-center min-h-[190px]">
      {/* CSS 3D Cube Animation Styles */}
      <style>{`
        @keyframes rollDice3D_A {
          0% {
            transform: translateY(0px) rotateX(0deg) rotateY(0deg) rotateZ(0deg);
          }
          20% {
            transform: translateY(-26px) rotateX(240deg) rotateY(180deg) rotateZ(45deg);
          }
          40% {
            transform: translateY(-4px) rotateX(460deg) rotateY(360deg) rotateZ(120deg);
          }
          60% {
            transform: translateY(-32px) rotateX(680deg) rotateY(540deg) rotateZ(210deg);
          }
          80% {
            transform: translateY(-6px) rotateX(920deg) rotateY(720deg) rotateZ(290deg);
          }
          100% {
            transform: translateY(0px) rotateX(1080deg) rotateY(900deg) rotateZ(360deg);
          }
        }

        @keyframes rollDice3D_B {
          0% {
            transform: translateY(0px) rotateX(0deg) rotateY(0deg) rotateZ(0deg);
          }
          25% {
            transform: translateY(-30px) rotateX(-200deg) rotateY(-270deg) rotateZ(-60deg);
          }
          50% {
            transform: translateY(-5px) rotateX(-450deg) rotateY(-540deg) rotateZ(-130deg);
          }
          75% {
            transform: translateY(-24px) rotateX(-720deg) rotateY(-780deg) rotateZ(-220deg);
          }
          100% {
            transform: translateY(0px) rotateX(-1080deg) rotateY(-990deg) rotateZ(-360deg);
          }
        }

        @keyframes floatGentle {
          0%, 100% {
            transform: translateY(0px);
          }
          50% {
            transform: translateY(-5px);
          }
        }

        .animate-roll-a {
          animation: rollDice3D_A 0.45s infinite linear;
        }

        .animate-roll-b {
          animation: rollDice3D_B 0.5s infinite linear;
        }

        .animate-float {
          animation: floatGentle 2.6s ease-in-out infinite;
        }

        .perspective-dice {
          perspective: 900px;
        }
      `}</style>

      {/* Background Ambience Felt Circle */}
      <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
        <div className="w-64 h-36 rounded-full bg-amber-500/5 blur-2xl" />
        <div className="w-56 h-28 rounded-full border border-dashed border-amber-500/20" />
      </div>

      {/* CENTRAL 3D DICE STAGE */}
      <div className="relative z-10 w-full flex items-center justify-center gap-6 sm:gap-10 perspective-dice py-2">
        {/* Die 1 */}
        <DieCube
          targetValue={status === 'RESULT' ? d1 : 3}
          isRolling={isRolling}
          won={won}
          offsetDeg={-12}
          rollClass="animate-roll-a"
        />

        {/* Die 2 */}
        <DieCube
          targetValue={status === 'RESULT' ? d2 : 4}
          isRolling={isRolling}
          won={won}
          offsetDeg={14}
          rollClass="animate-roll-b"
        />
      </div>

      {/* RESULT & STATUS BANNER (Right under the 3D dice) */}
      <div className="relative z-10 mt-2 flex flex-col items-center">
        {status === 'ROLLING' && (
          <div className="flex items-center gap-2 px-3 py-1 rounded-xl bg-amber-500/20 border border-amber-500/50 text-amber-300 text-xs font-bold animate-pulse shadow-lg">
            <Sparkles className="w-3.5 h-3.5 animate-spin text-amber-400" />
            <span>ROLLING DICE (డైస్ రోల్ అవుతోంది)...</span>
          </div>
        )}

        {status === 'RESULT' && rollValue !== null && (
          <div
            className={`flex items-center gap-2 px-4 py-1.5 rounded-2xl border shadow-xl transition-all duration-300 scale-105 ${
              won
                ? 'bg-gradient-to-r from-emerald-950 via-emerald-900 to-zinc-950 border-emerald-400 text-emerald-200 shadow-[0_0_25px_rgba(16,185,129,0.5)]'
                : 'bg-gradient-to-r from-amber-950 via-zinc-900 to-zinc-950 border-amber-400 text-amber-200 shadow-[0_0_20px_rgba(245,158,11,0.4)]'
            }`}
          >
            <Trophy className="w-4 h-4 text-amber-400 animate-bounce shrink-0" />
            <div className="flex items-center gap-1.5 font-mono">
              <span className="text-xs uppercase font-sans font-bold text-zinc-300">Rolled:</span>
              <span className="text-lg font-black text-amber-300 font-mono">#{rollValue}</span>
              {rollValue > 1 && (
                <span className="text-[11px] text-zinc-400 font-sans ml-1">
                  ({d1} + {d2})
                </span>
              )}
            </div>
            {won && (
              <span className="ml-1 px-1.5 py-0.2 rounded-full bg-emerald-500 text-zinc-950 text-[9px] font-black uppercase">
                YOU WON!
              </span>
            )}
          </div>
        )}

        {status === 'BETTING' && (
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-zinc-900/90 border border-zinc-800 text-zinc-300 text-xs font-semibold">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping mr-0.5" />
            <span className="text-emerald-400 font-bold">READY TO ROLL</span>
            <span className="text-zinc-500">•</span>
            <span className="text-zinc-400 text-[11px]">నంబర్లు 1-10 ఎంచుకోండి</span>
          </div>
        )}
      </div>
    </div>
  );
};
