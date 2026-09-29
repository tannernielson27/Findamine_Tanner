"use client";

import { useState, useRef, useEffect } from "react";
import { Camera, ChevronDown, ChevronUp, Mic, RotateCcw, Square } from "lucide-react";

interface ChallengeInputProps {
  challengeType: string;
  content: Record<string, unknown>;
  answer: string;
  onAnswerChange: (answer: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
}

/**
 * Renders the appropriate input UI based on challenge type.
 * Falls back to text input for unrecognized types.
 */
export default function ChallengeInput({
  challengeType,
  content,
  answer,
  onAnswerChange,
  onSubmit,
  disabled,
}: ChallengeInputProps) {
  switch (challengeType) {
    case "multiple_choice":
      return (
        <MultipleChoice
          content={content}
          answer={answer}
          onAnswerChange={onAnswerChange}
          onSubmit={onSubmit}
          disabled={disabled}
        />
      );

    case "numeric_entry":
      return (
        <NumericEntry
          content={content}
          answer={answer}
          onAnswerChange={onAnswerChange}
          onSubmit={onSubmit}
          disabled={disabled}
        />
      );

    case "sorting_ordering":
      return (
        <SortingOrdering
          content={content}
          answer={answer}
          onAnswerChange={onAnswerChange}
          onSubmit={onSubmit}
          disabled={disabled}
        />
      );

    case "photo_observation":
      return (
        <PhotoObservation
          content={content}
          answer={answer}
          onAnswerChange={onAnswerChange}
          onSubmit={onSubmit}
          disabled={disabled}
        />
      );

    case "sketch_draw":
      return (
        <SketchDraw
          content={content}
          answer={answer}
          onAnswerChange={onAnswerChange}
          onSubmit={onSubmit}
          disabled={disabled}
        />
      );

    case "audio_response":
      return (
        <AudioResponse
          content={content}
          answer={answer}
          onAnswerChange={onAnswerChange}
          onSubmit={onSubmit}
          disabled={disabled}
        />
      );

    default:
      // short_text, creative_writing, data_collection, team_debate
      return (
        <TextInput
          challengeType={challengeType}
          answer={answer}
          onAnswerChange={onAnswerChange}
          onSubmit={onSubmit}
          disabled={disabled}
        />
      );
  }
}

// ── Multiple Choice ──────────────────────────────────

function MultipleChoice({
  content,
  answer,
  onAnswerChange,
  onSubmit,
  disabled,
}: {
  content: Record<string, unknown>;
  answer: string;
  onAnswerChange: (a: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
}) {
  const options = (content.options as string[]) || [];
  const question = (content.question as string) || (content.text as string) || "";

  return (
    <div>
      {question && (
        <p className="text-base text-themed-text mb-3">{question}</p>
      )}
      <div className="space-y-2 mb-4" role="radiogroup" aria-label={question || "Answer options"}>
        {options.map((option, idx) => {
          const letter = String.fromCharCode(65 + idx); // A, B, C, D
          const isSelected = answer === option;
          return (
            <button
              key={idx}
              role="radio"
              aria-checked={isSelected}
              onClick={() => onAnswerChange(option)}
              disabled={disabled}
              className={`flex min-h-12 w-full items-center text-left rounded-lg border-2 px-4 py-3 text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 ${
                isSelected
                  ? "border-link bg-link/10 text-themed-text font-semibold"
                  : "border-themed-border bg-surface text-themed-text hover:border-link/50 hover:bg-themed-bg"
              } disabled:opacity-50`}
            >
              <span className={`inline-flex shrink-0 items-center justify-center w-7 h-7 rounded-full text-sm font-bold mr-3 ${isSelected ? "bg-link text-white" : "bg-themed-bg text-themed-muted"}`} aria-hidden="true">
                {letter}
              </span>
              {option}
            </button>
          );
        })}
      </div>
      <button
        onClick={onSubmit}
        disabled={!answer || disabled}
        className="flex min-h-12 w-full items-center justify-center rounded-lg bg-brand px-4 text-base font-semibold text-white transition-colors hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-50"
      >
        Submit Answer
      </button>
    </div>
  );
}

// ── Numeric Entry ────────────────────────────────────

function NumericEntry({
  content,
  answer,
  onAnswerChange,
  onSubmit,
  disabled,
}: {
  content: Record<string, unknown>;
  answer: string;
  onAnswerChange: (a: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
}) {
  const question = (content.question as string) || (content.text as string) || "";
  const unit = (content.unit as string) || "";
  const placeholder = (content.placeholder as string) || "Enter a number...";

  return (
    <div>
      {question && (
        <p className="text-base text-themed-text mb-3">{question}</p>
      )}
      <div className="flex gap-2 mb-4">
        <input
          type="number"
          inputMode="decimal"
          value={answer}
          onChange={(e) => onAnswerChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          aria-label={question || "Enter your numeric answer"}
          className="min-h-12 min-w-0 flex-1 tabular-nums rounded-lg border border-themed-border bg-surface px-3 py-2 text-base text-themed-text placeholder:text-themed-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50"
          onKeyDown={(e) => e.key === "Enter" && onSubmit()}
        />
        {unit && (
          <span className="flex items-center text-base text-themed-muted px-2">{unit}</span>
        )}
      </div>
      <button
        onClick={onSubmit}
        disabled={!answer || disabled}
        className="flex min-h-12 w-full items-center justify-center rounded-lg bg-brand px-4 text-base font-semibold text-white transition-colors hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-50"
      >
        Submit Answer
      </button>
    </div>
  );
}

// ── Sorting / Ordering ───────────────────────────────

function SortingOrdering({
  content,
  answer,
  onAnswerChange,
  onSubmit,
  disabled,
}: {
  content: Record<string, unknown>;
  answer: string;
  onAnswerChange: (a: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
}) {
  const items = (content.items as string[]) || [];
  const question = (content.question as string) || (content.text as string) || "Put these in the correct order:";

  // Parse current order from answer (comma-separated) or initialize shuffled
  const [order, setOrder] = useState<string[]>(() => {
    if (answer) return answer.split(",");
    // Shuffle items for initial display
    return [...items].sort(() => Math.random() - 0.5);
  });

  const moveItem = (fromIdx: number, toIdx: number) => {
    if (disabled) return;
    const newOrder = [...order];
    const [moved] = newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, moved);
    setOrder(newOrder);
    onAnswerChange(newOrder.join(","));
  };

  return (
    <div>
      <p className="text-base text-themed-text mb-3">{question}</p>
      <div className="space-y-2 mb-4">
        {order.map((item, idx) => (
          <div
            key={item}
            className="flex items-center gap-2 rounded-lg border border-themed-border bg-surface py-1 pl-4 pr-1 text-base text-themed-text"
          >
            <span className="text-themed-muted text-sm font-semibold tabular-nums w-6">{idx + 1}.</span>
            <span className="min-w-0 flex-1">{item}</span>
            <div className="flex shrink-0 gap-1">
              <button
                onClick={() => moveItem(idx, idx - 1)}
                disabled={idx === 0 || disabled}
                className="flex h-11 w-11 items-center justify-center rounded-lg text-themed-muted transition-colors hover:bg-themed-bg hover:text-themed-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-30"
                aria-label="Move up"
              >
                <ChevronUp className="h-5 w-5" aria-hidden="true" />
              </button>
              <button
                onClick={() => moveItem(idx, idx + 1)}
                disabled={idx === order.length - 1 || disabled}
                className="flex h-11 w-11 items-center justify-center rounded-lg text-themed-muted transition-colors hover:bg-themed-bg hover:text-themed-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-30"
                aria-label="Move down"
              >
                <ChevronDown className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
          </div>
        ))}
      </div>
      <button
        onClick={onSubmit}
        disabled={!answer || disabled}
        className="flex min-h-12 w-full items-center justify-center rounded-lg bg-brand px-4 text-base font-semibold text-white transition-colors hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-50"
      >
        Submit Order
      </button>
    </div>
  );
}

// ── Photo Observation ────────────────────────────────

function PhotoObservation({
  content,
  answer,
  onAnswerChange,
  onSubmit,
  disabled,
}: {
  content: Record<string, unknown>;
  answer: string;
  onAnswerChange: (a: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
}) {
  const question = (content.question as string) || (content.text as string) || "Take a photo and describe what you observe.";
  const [preview, setPreview] = useState<string | null>(null);
  const [observation, setObservation] = useState(answer);

  const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      setPreview(base64);
      // Combine photo reference + observation text as the answer
      onAnswerChange(`[photo:captured] ${observation}`);
    };
    reader.readAsDataURL(file);
  };

  const handleObservationChange = (text: string) => {
    setObservation(text);
    onAnswerChange(preview ? `[photo:captured] ${text}` : text);
  };

  return (
    <div>
      <p className="text-base text-themed-text mb-3">{question}</p>

      {/* Photo capture */}
      {preview ? (
        <div className="mb-3 text-center">
          <img src={preview} alt="Your observation" className="rounded-xl max-h-48 mx-auto mb-2" />
          <button
            onClick={() => { setPreview(null); onAnswerChange(observation); }}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-link transition-colors hover:text-link-dark hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Retake photo
          </button>
        </div>
      ) : (
        <label className="flex min-h-32 items-center justify-center rounded-xl border-2 border-dashed border-themed-border bg-surface p-6 mb-3 cursor-pointer transition-colors hover:border-link hover:bg-link/5 focus-within:ring-2 focus-within:ring-brand focus-within:ring-offset-2">
          <div className="text-center">
            <Camera className="mx-auto mb-2 h-8 w-8 text-link" aria-hidden="true" />
            <p className="text-base font-semibold text-themed-text">Tap to take a photo</p>
          </div>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={handlePhoto}
            disabled={disabled}
          />
        </label>
      )}

      {/* Observation text */}
      <textarea
        value={observation}
        onChange={(e) => handleObservationChange(e.target.value)}
        placeholder="Describe what you observe..."
        rows={3}
        disabled={disabled}
        aria-label="Describe what you observe"
        className="w-full rounded-lg border border-themed-border bg-surface px-3 py-2 text-base text-themed-text placeholder:text-themed-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50 mb-3 resize-y"
      />

      <button
        onClick={onSubmit}
        disabled={!observation.trim() || disabled}
        className="flex min-h-12 w-full items-center justify-center rounded-lg bg-brand px-4 text-base font-semibold text-white transition-colors hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-50"
      >
        Submit Observation
      </button>
    </div>
  );
}

// ── Sketch / Draw ────────────────────────────────────

function SketchDraw({
  content,
  answer,
  onAnswerChange,
  onSubmit,
  disabled,
}: {
  content: Record<string, unknown>;
  answer: string;
  onAnswerChange: (a: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
}) {
  const question = (content.question as string) || (content.text as string) || "Draw your answer below.";
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  const getPos = (e: React.TouchEvent | React.MouseEvent): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if ("touches" in e) {
      const touch = e.touches[0];
      return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top };
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

// ── Audio Response ───────────────────────────────────

function AudioResponse({
  content,
  answer,
  onAnswerChange,
  onSubmit,
  disabled,
}: {
  content: Record<string, unknown>;
  answer: string;
  onAnswerChange: (a: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
}) {
  const question = (content.question as string) || (content.text as string) || "Record your spoken answer.";
  const [recording, setRecording] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [permissionError, setPermissionError] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        onAnswerChange(`[audio:${Math.round(duration)}s]`);
        stream.getTracks().forEach((t) => t.stop());
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setDuration(0);
      setAudioUrl(null);

      timerRef.current = setInterval(() => {
        setDuration((d) => d + 1);
      }, 1000);
    } catch {
      setPermissionError(true);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const resetRecording = () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setDuration(0);
    onAnswerChange("");
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  return (
    <div>
      <p className="text-base text-themed-text mb-3">{question}</p>

      {permissionError && (
        <div className="rounded-lg bg-error/10 border border-error/30 p-3 mb-3" role="alert">
          <p className="text-base text-error">
            Microphone access denied. Please enable microphone permissions in your browser settings.
          </p>
        </div>
      )}

      <div className="rounded-xl border border-themed-border bg-themed-bg p-4 mb-3 text-center">
        {recording ? (
          <div>
            <div className="flex items-center justify-center gap-2 mb-3">
              <span className="w-3 h-3 rounded-full bg-error animate-pulse" aria-hidden="true" />
              <span className="text-base font-semibold text-error">Recording</span>
              <span className="text-base text-themed-muted tabular-nums">{formatTime(duration)}</span>
            </div>
            <button
              onClick={stopRecording}
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-error px-6 text-base font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error focus-visible:ring-offset-2 sm:w-auto"
            >
              <Square className="h-4 w-4" aria-hidden="true" />
              Stop Recording
            </button>
          </div>
        ) : audioUrl ? (
          <div>
            <audio src={audioUrl} controls className="mx-auto mb-3 w-full max-w-xs" />
            <p className="text-sm text-themed-muted tabular-nums mb-2">Duration: {formatTime(duration)}</p>
            <button
              onClick={resetRecording}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-link transition-colors hover:text-link-dark hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Record again
            </button>
          </div>
        ) : (
          <div>
            <Mic className="mx-auto mb-2 h-8 w-8 text-link" aria-hidden="true" />
            <button
              onClick={startRecording}
              disabled={disabled || permissionError}
              className="inline-flex min-h-12 w-full items-center justify-center rounded-lg border-2 border-brand bg-surface px-6 text-base font-semibold text-brand-dark transition-colors hover:bg-brand-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-50 sm:w-auto"
            >
              Start Recording
            </button>
            <p className="text-sm text-themed-muted mt-2">Tap to record your spoken answer</p>
          </div>
        )}
      </div>

      <button
        onClick={onSubmit}
        disabled={!audioUrl || disabled}
        className="flex min-h-12 w-full items-center justify-center rounded-lg bg-brand px-4 text-base font-semibold text-white transition-colors hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-50"
      >
        Submit Recording
      </button>
    </div>
  );
}

// ── Text Input (default fallback) ────────────────────

function TextInput({
  challengeType,
  answer,
  onAnswerChange,
  onSubmit,
  disabled,
}: {
  challengeType: string;
  answer: string;
  onAnswerChange: (a: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
}) {
  const isLongForm = ["creative_writing", "data_collection", "team_debate"].includes(challengeType);

  return (
    <div>
      {isLongForm ? (
        <textarea
          value={answer}
          onChange={(e) => onAnswerChange(e.target.value)}
          placeholder="Your answer..."
          disabled={disabled}
          rows={5}
          aria-label="Your answer"
          className="w-full rounded-lg border border-themed-border bg-surface px-3 py-2 text-base text-themed-text placeholder:text-themed-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50 mb-3 resize-y"
        />
      ) : (
        <input
          type="text"
          value={answer}
          onChange={(e) => onAnswerChange(e.target.value)}
          placeholder="Your answer..."
          disabled={disabled}
          aria-label="Your answer"
          className="min-h-12 w-full rounded-lg border border-themed-border bg-surface px-3 py-2 text-base text-themed-text placeholder:text-themed-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50 mb-3"
          onKeyDown={(e) => e.key === "Enter" && onSubmit()}
        />
      )}
      <button
        onClick={onSubmit}
        disabled={!answer || disabled}
        className="flex min-h-12 w-full items-center justify-center rounded-lg bg-brand px-4 text-base font-semibold text-white transition-colors hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-50"
      >
        Submit
      </button>
    </div>
  );
}
