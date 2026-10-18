import React, { useRef, useEffect } from 'react';

interface DiceCanvasProps {
  isRolling: boolean;
  rollValue: number | null; // 1 to 10 when settled, null otherwise
  won: boolean | null;
}

export const DiceCanvas: React.FC<DiceCanvasProps> = ({ isRolling, rollValue, won }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Shaker and physics state
  const physicsRef = useRef({
    t: 0,
    cupLift: 0, // 0 = fully down, 1 = fully lifted
    targetLift: 0,
    cupShakeX: 0,
    cupShakeY: 0,
    cupRot: 0,
    sparks: [] as Array<{
      x: number;
      y: number;
      vx: number;
      vy: number;
      life: number;
      color: string;
      size: number;
    }>,
  });

  useEffect(() => {
    // When rollValue is revealed (RESULT), cup should lift up!
    // When rollValue is null (BETTING / ROLLING), cup is down over the dice.
    if (rollValue !== null) {
      physicsRef.current.targetLift = 1;
    } else {
      physicsRef.current.targetLift = 0;
    }
  }, [rollValue]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = (canvas.width = canvas.parentElement?.clientWidth || 400);
    let height = (canvas.height = 160);

    const handleResize = () => {
      if (canvas && canvas.parentElement) {
        width = canvas.width = canvas.parentElement.clientWidth;
        height = canvas.height = 160;
      }
    };
    window.addEventListener('resize', handleResize);

    const render = () => {
      ctx.clearRect(0, 0, width, height);
      const state = physicsRef.current;
      state.t += 0.016;

      const centerX = width / 2;
      const centerY = height * 0.54;

      // 1. Casino Felt Table Base with radial glow
      const feltGrad = ctx.createRadialGradient(centerX, centerY, 20, centerX, centerY, width * 0.55);
      feltGrad.addColorStop(0, '#1c1917');
      feltGrad.addColorStop(0.6, '#0f0e0d');
      feltGrad.addColorStop(1, '#050505');
      ctx.fillStyle = feltGrad;
      ctx.fillRect(0, 0, width, height);

      // 2. Circular Felt Inlay Ring
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(centerX, centerY + 24, width * 0.42, 42, 0, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.22)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Inner dashed accent
      ctx.beginPath();
      ctx.ellipse(centerX, centerY + 24, width * 0.36, 34, 0, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.12)';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // Smooth cup lift interpolation
      state.cupLift += (state.targetLift - state.cupLift) * 0.14;

      // 3. Shake physics calculation
      if (isRolling) {
        // High intensity shaker vibration
        state.cupShakeX = Math.sin(state.t * 32) * 9 + Math.cos(state.t * 48) * 4;
        state.cupShakeY = Math.abs(Math.sin(state.t * 26)) * -8;
        state.cupRot = Math.sin(state.t * 28) * 0.12;

        // Spawn fiery golden sparks escaping from shaker rim
        if (Math.random() < 0.6) {
          state.sparks.push({
            x: centerX + (Math.random() - 0.5) * 80,
            y: centerY + 25 + (Math.random() - 0.5) * 8,
            vx: (Math.random() - 0.5) * 4,
            vy: -1 - Math.random() * 3,
            life: 1.0,
            color: Math.random() > 0.3 ? '#f59e0b' : '#fbbf24',
            size: 2 + Math.random() * 2.5,
          });
        }
      } else {
        state.cupShakeX *= 0.8;
        state.cupShakeY *= 0.8;
        state.cupRot *= 0.8;
      }

      // 4. DRAW REVEALED DICE (Only when cup is lifting or lifted)
      if (state.cupLift > 0.05 && rollValue !== null) {
        ctx.save();
        const diceAlpha = Math.min(1, state.cupLift * 1.5);
        ctx.globalAlpha = diceAlpha;

        // Spotlights on table
        const spotGrad = ctx.createRadialGradient(centerX, centerY + 10, 5, centerX, centerY + 10, 65);
        spotGrad.addColorStop(0, won ? 'rgba(16, 185, 129, 0.45)' : 'rgba(245, 158, 11, 0.45)');
        spotGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = spotGrad;
        ctx.beginPath();
        ctx.arc(centerX, centerY + 10, 65, 0, Math.PI * 2);
        ctx.fill();

        // Draw 3D Lucky Number Hex Cube
        const cubeSize = 36;
        const leftX = centerX - 34;
        const rightX = centerX + 34;

        // Compute 2 dice values summing to or representing the rollValue (1 to 10)
        let d1Val = Math.min(6, Math.max(1, Math.floor(rollValue / 2)));
        let d2Val = rollValue - d1Val;
        if (d2Val < 1) {
          d1Val = 1;
          d2Val = rollValue === 1 ? 0 : 1;
        }

        const drawCasinoDie = (dx: number, dy: number, val: number, isSingleBadge = false) => {
          ctx.save();
          ctx.translate(dx, dy);

          // Shadow
          ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
          ctx.shadowBlur = 12;
          ctx.shadowOffsetY = 6;

          // Die Body Gradient
          const dGrad = ctx.createLinearGradient(-cubeSize, -cubeSize, cubeSize, cubeSize);
          if (won) {
            dGrad.addColorStop(0, '#ffffff');
            dGrad.addColorStop(0.5, '#ecfdf5');
            dGrad.addColorStop(1, '#a7f3d0');
          } else {
            dGrad.addColorStop(0, '#ffffff');
            dGrad.addColorStop(0.5, '#fef3c7');
            dGrad.addColorStop(1, '#fde68a');
          }

          ctx.beginPath();
          ctx.roundRect(-cubeSize, -cubeSize, cubeSize * 2, cubeSize * 2, 9);
          ctx.fillStyle = dGrad;
          ctx.fill();

          ctx.shadowColor = 'transparent';
          ctx.lineWidth = 2;
          ctx.strokeStyle = won ? '#10b981' : '#f59e0b';
          ctx.stroke();

          // Big bold number inside die
          ctx.fillStyle = '#18181b';
          ctx.font = 'bold 26px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`${val}`, 0, 2);

          ctx.restore();
        };

        // Center prominent Winning Die Badge
        ctx.save();
        ctx.translate(centerX, centerY + 8);
        ctx.shadowColor = won ? 'rgba(16, 185, 129, 0.8)' : 'rgba(245, 158, 11, 0.8)';
        ctx.shadowBlur = 24;

        const badgeGrad = ctx.createLinearGradient(-38, -38, 38, 38);
        if (won) {
          badgeGrad.addColorStop(0, '#10b981');
          badgeGrad.addColorStop(1, '#064e3b');
        } else {
          badgeGrad.addColorStop(0, '#f59e0b');
          badgeGrad.addColorStop(1, '#78350f');
        }

        ctx.beginPath();
        ctx.roundRect(-38, -38, 76, 76, 16);
        ctx.fillStyle = badgeGrad;
        ctx.fill();

        ctx.lineWidth = 3;
        ctx.strokeStyle = '#fef08a';
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = '900 40px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${rollValue}`, 0, 1);

        // Subtitle "ROLLED"
        ctx.font = 'bold 10px sans-serif';
        ctx.fillStyle = won ? '#a7f3d0' : '#fde68a';
        ctx.fillText('WINNER', 0, 26);
        ctx.restore();

        ctx.restore();
      }

      // 5. DRAW GOLDEN CASINO SHAKER CUP (Dome)
      const cupLiftPx = state.cupLift * 88; // Lifts up by 88px
      const cupX = centerX + state.cupShakeX;
      const cupY = centerY - cupLiftPx + state.cupShakeY;

      ctx.save();
      ctx.translate(cupX, cupY);
      ctx.rotate(state.cupRot);

      // Shadow under cup
      ctx.save();
      const shadowAlpha = Math.max(0.1, 0.65 - state.cupLift * 0.45);
      const shadowScale = 1 - state.cupLift * 0.25;
      ctx.beginPath();
      ctx.ellipse(0, 26 + cupLiftPx * 0.8, 56 * shadowScale, 18 * shadowScale, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0, 0, 0, ${shadowAlpha})`;
      ctx.fill();
      ctx.restore();

      // Cup 3D Glow
      ctx.shadowColor = isRolling ? 'rgba(245, 158, 11, 0.8)' : 'rgba(217, 119, 6, 0.4)';
      ctx.shadowBlur = isRolling ? 22 : 14;

      // Draw Cup Body (Classic Luxury Bell Shaker)
      const cupWidthTop = 32;
      const cupWidthMid = 48;
      const cupWidthBase = 44;
      const cupHeight = 65;

      const cupGrad = ctx.createLinearGradient(-cupWidthMid, -cupHeight, cupWidthMid, 20);
      cupGrad.addColorStop(0, '#fef08a');
      cupGrad.addColorStop(0.2, '#f59e0b');
      cupGrad.addColorStop(0.5, '#d97706');
      cupGrad.addColorStop(0.8, '#b45309');
      cupGrad.addColorStop(1, '#78350f');

      ctx.beginPath();
      // Start top center
      ctx.moveTo(-cupWidthTop, -cupHeight);
      ctx.bezierCurveTo(-cupWidthMid - 6, -cupHeight * 0.5, -cupWidthMid - 4, 10, -cupWidthBase, 20);
      // Bottom lip curve
      ctx.bezierCurveTo(-cupWidthBase * 0.5, 27, cupWidthBase * 0.5, 27, cupWidthBase, 20);
      ctx.bezierCurveTo(cupWidthMid + 4, 10, cupWidthMid + 6, -cupHeight * 0.5, cupWidthTop, -cupHeight);
      // Top dome curve
      ctx.bezierCurveTo(cupWidthTop * 0.5, -cupHeight - 12, -cupWidthTop * 0.5, -cupHeight - 12, -cupWidthTop, -cupHeight);
      ctx.closePath();

      ctx.fillStyle = cupGrad;
      ctx.fill();

      // Metallic rim border
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#fef08a';
      ctx.stroke();

      // Top Finial Handle / Knob
      ctx.beginPath();
      ctx.arc(0, -cupHeight - 9, 8, 0, Math.PI * 2);
      ctx.fillStyle = '#fef08a';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#b45309';
      ctx.stroke();

      // Decorative Ruby Ring on Handle
      ctx.beginPath();
      ctx.arc(0, -cupHeight - 9, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#dc2626';
      ctx.fill();

      // Engraved Dice Crest on Center of Cup
      ctx.beginPath();
      ctx.roundRect(-16, -28, 32, 32, 6);
      ctx.fillStyle = 'rgba(120, 53, 15, 0.7)';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(254, 240, 138, 0.7)';
      ctx.stroke();

      // Engraved Text / Symbol
      ctx.fillStyle = '#fef08a';
      ctx.font = '900 13px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('10', 0, -12);

      // Bottom Rim Ring
      ctx.beginPath();
      ctx.ellipse(0, 20, cupWidthBase, 7, 0, 0, Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#fef08a';
      ctx.stroke();

      ctx.restore();

      // 6. Draw Sparks
      for (let i = state.sparks.length - 1; i >= 0; i--) {
        const p = state.sparks[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.05;

        if (p.life <= 0) {
          state.sparks.splice(i, 1);
          continue;
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.life;
        ctx.fill();
        ctx.globalAlpha = 1.0;
      }

      // 7. Status Banner Underneath Canvas
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = 'bold 11px sans-serif';

      if (isRolling) {
        ctx.fillStyle = '#f59e0b';
        ctx.fillText('⚡ SHAKING LUCKY DICE (రోల్ అవుతోంది)...', centerX, height - 10);
      } else if (rollValue !== null) {
        ctx.fillStyle = won ? '#34d399' : '#fde047';
        ctx.fillText(`🎉 ROLLED: NUMBER #${rollValue} (ఫలితం)`, centerX, height - 10);
      } else {
        ctx.fillStyle = '#9ca3af';
        ctx.fillText('🔒 SHAKER SEALED • నంబర్లు 1-10 ఎంచుకోండి', centerX, height - 10);
      }
      ctx.restore();

      animFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isRolling, rollValue, won]);

  return (
    <div className="w-full relative overflow-hidden rounded-2xl border border-amber-500/30 bg-zinc-950 shadow-2xl">
      <canvas ref={canvasRef} className="w-full block" />
    </div>
  );
};
