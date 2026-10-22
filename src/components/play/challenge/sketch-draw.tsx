"use client";

import { useEffect, useRef, useState } from "react";
import { FIELD_CLASS, QuestionText, SubmitButton, TEXT_ACTION_CLASS } from "./parts";
import { questionOf, type ChallengeFieldProps } from "./types";

export function SketchDraw({
  content,
  answer,
  onAnswerChange,
  onSubmit,
  disabled,
  showQuestion = true,
}: ChallengeFieldProps) {
  const question = questionOf(content, "Draw your answer below.");
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
    <div className="flex flex-col gap-3">
      <QuestionText show={showQuestion}>{question}</QuestionText>

      <div className="overflow-hidden rounded-2xl border-2 border-themed-border bg-white">
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

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={clearCanvas} disabled={disabled} className={TEXT_ACTION_CLASS}>
          Clear drawing
        </button>
        <span className="text-base text-ink" aria-live="polite">
          {hasDrawn ? "Drawing captured" : "Draw with your finger"}
        </span>
      </div>

      <SubmitButton
        ready={hasDrawn || !!answer}
        disabled={disabled}
        onClick={onSubmit}
        label="Submit drawing"
        waitingLabel="Draw your answer"
      />

      {/* Keyboard alternative: text description */}
      <div className="border-t border-themed-border pt-3">
        <p className="mb-1 text-base text-ink">Can&apos;t draw? Describe your answer instead:</p>
        <textarea
          value={answer.startsWith("[sketch:") ? "" : answer}
          onChange={(e) => onAnswerChange(e.target.value)}
          placeholder="Describe what you would draw..."
          rows={2}
          disabled={disabled}
          aria-label="Text alternative for drawing"
          className={`${FIELD_CLASS} resize-y py-3`}
        />
      </div>
    </div>
  );
}
