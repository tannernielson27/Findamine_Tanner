"use client";

import { useEffect, useRef, useState } from "react";
import type { ChallengeFieldProps } from "./types";

export function SketchDraw({
  content,
  answer,
  onAnswerChange,
  onSubmit,
  disabled,
}: ChallengeFieldProps) {
  const question = (content.question as string) || (content.text as string) || "Draw your answer below.";
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  const getPos = (e: React.TouchEvent | React.MouseEvent): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    // The canvas bitmap is 400x280 but CSS stretches it to the container, so
    // convert from on-screen pixels to bitmap pixels or strokes land off-finger.
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const point = "touches" in e ? e.touches[0] : (e as React.MouseEvent);
    if (!point) return null;
    return {
      x: (point.clientX - rect.left) * scaleX,
      y: (point.clientY - rect.top) * scaleY,
    };
  };

  const startDraw = (e: React.TouchEvent | React.MouseEvent) => {
    if (disabled) return;
    e.preventDefault();
    const pos = getPos(e);
    if (!pos) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    setIsDrawing(true);
    setHasDrawn(true);
  };

  const draw = (e: React.TouchEvent | React.MouseEvent) => {
    if (!isDrawing || disabled) return;
    e.preventDefault();
    const pos = getPos(e);
    if (!pos) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1E293B";
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  };

  const endDraw = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    // Save canvas as data URL
    const canvas = canvasRef.current;
    if (canvas) {
      const dataUrl = canvas.toDataURL("image/png");
      onAnswerChange(`[sketch:${dataUrl.length}chars]`);
    }
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Redraw white background
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
    onAnswerChange("");
  };

  // Initialize white background
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  return (
    <div>
      <p className="text-base text-themed-text mb-3">{question}</p>

      <div className="rounded-xl border-2 border-themed-border overflow-hidden mb-2">
        <canvas
          ref={canvasRef}
          width={400}
          height={280}
          className="w-full touch-none cursor-crosshair"
          style={{ maxHeight: "280px" }}
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={endDraw}
        />
      </div>

      <div className="flex flex-wrap justify-between items-center gap-2 mb-3">
        <button
          onClick={clearCanvas}
          disabled={disabled}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-link transition-colors hover:text-link-dark hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
        >
          Clear drawing
        </button>
        <span className="text-sm text-themed-muted" aria-live="polite">
          {hasDrawn ? "Drawing captured" : "Draw with your finger or mouse"}
        </span>
      </div>

      <button
        onClick={onSubmit}
        disabled={(!hasDrawn && !answer) || disabled}
        className="flex min-h-12 w-full items-center justify-center rounded-lg bg-brand px-4 text-base font-semibold text-white transition-colors hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-50"
      >
        Submit Drawing
      </button>

      {/* Keyboard alternative: text description */}
      <div className="mt-3 border-t border-themed-border pt-3">
        <p className="text-sm text-themed-muted mb-1">Can&apos;t draw? Describe your answer instead:</p>
        <textarea
          value={answer.startsWith("[sketch:") ? "" : answer}
          onChange={(e) => onAnswerChange(e.target.value)}
          placeholder="Describe what you would draw..."
          rows={2}
          disabled={disabled}
          aria-label="Text alternative for drawing"
          className="w-full rounded-lg border border-themed-border bg-surface px-3 py-2 text-base text-themed-text placeholder:text-themed-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50 resize-y"
        />
      </div>
    </div>
  );
}
