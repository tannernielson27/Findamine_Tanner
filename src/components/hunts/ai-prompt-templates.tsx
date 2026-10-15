"use client";

import { useState } from "react";
import { type AiMode, AI_MODES } from "./ai-mode-indicator";

interface AiPromptTemplatesProps {
  onSelectPrompt: (prompt: string, mode: AiMode) => void;
  topic?: string;
}

interface PromptTemplate {
  mode: AiMode;
  label: string;
  template: string;
  placeholder: string;
}

const TEMPLATES: PromptTemplate[] = [
  {
    mode: 4,
    label: "Improve my draft",
    template: "Here's my lesson plan for {topic}: [PASTE YOUR DRAFT]. Help me turn it into a scavenger hunt stop. What am I missing?",
    placeholder: "Paste your primer or lesson plan draft here...",
  },
  {
    mode: 3,
    label: "Help me understand",
    template: "I want to teach {topic} to students outdoors. What are the 3 most important concepts they should understand? What misconceptions should I address?",
    placeholder: "What topic do you want to teach?",
  },
  {
    mode: 5,
    label: "Check my content",
    template: "I wrote this primer: [PASTE PRIMER]. Is it factually accurate? What did I get wrong? What important details am I missing?",
    placeholder: "Paste your primer content to verify...",
  },
  {
    mode: 6,
    label: "Suggest alternatives",
    template: "I'm teaching {topic} outdoors to [who's playing, e.g. 5th graders or college freshmen]. Give me 3 challenge types I haven't considered. What creative approaches would make this memorable?",
    placeholder: "What topic, and who's playing?",
  },
  {
    mode: 7,
    label: "Challenge my task",
    template: "My task question is: [PASTE QUESTION]. What's wrong with it? How could students misunderstand it? How would you make it more rigorous?",
    placeholder: "Paste your challenge question...",
  },
  {
    mode: 8,
    label: "Rethink my approach",
    template: "I've been framing this as a {topic} activity. Should I approach it differently? What if I framed it as [another subject] instead? Am I asking the right question?",
    placeholder: "What's your current framing?",
  },
];

export default function AiPromptTemplates({ onSelectPrompt, topic }: AiPromptTemplatesProps) {
  const [selectedTemplate, setSelectedTemplate] = useState<PromptTemplate | null>(null);
  const [userInput, setUserInput] = useState("");

  function handleUseTemplate(template: PromptTemplate) {
    setSelectedTemplate(template);
    // Pre-fill topic if available
    if (topic) {
      setUserInput(template.template.replace("{topic}", topic));
    }
  }

  function handleSubmit() {
    if (!selectedTemplate || !userInput.trim()) return;
    onSelectPrompt(userInput, selectedTemplate.mode);
    setSelectedTemplate(null);
    setUserInput("");
  }

  if (selectedTemplate) {
    const info = AI_MODES[selectedTemplate.mode];
    return (
      <div className={`rounded-lg ${info.bgColor} border ${info.borderColor} p-3`}>
        <div className="flex items-center justify-between mb-2">
          <span className={`text-xs font-medium ${info.color}`}>
            Mode {selectedTemplate.mode}: {info.name} — {selectedTemplate.label}
          </span>
          <button onClick={() => setSelectedTemplate(null)} className="text-xs text-gray-500 hover:text-gray-700">
            Change mode
          </button>
        </div>
        <textarea
          value={userInput}
          onChange={(e) => setUserInput(e.target.value.slice(0, 5000))}
          placeholder={selectedTemplate.placeholder}
          rows={4}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm mb-2"
        />
        <div className="flex items-center justify-between">
          <p className="text-[11px] text-gray-500">{userInput.length}/5000</p>
          <button
            onClick={handleSubmit}
            disabled={!userInput.trim()}
            className="rounded-md bg-violet-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
          >
            Generate with AI
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-violet-50 border border-violet-200 p-3">
      <p className="text-xs font-medium text-violet-900 mb-2">Choose how to engage with AI:</p>
      <div className="grid grid-cols-2 gap-1.5">
        {TEMPLATES.map((t) => {
          const info = AI_MODES[t.mode];
          return (
            <button
              key={t.mode}
              onClick={() => handleUseTemplate(t)}
              className={`text-left rounded-md px-2.5 py-2 text-xs border transition hover:shadow-sm ${info.bgColor} ${info.borderColor} border`}
            >
              <span className={`font-medium ${info.color}`}>{t.label}</span>
              <p className="text-gray-500 text-[11px] mt-0.5">Mode {t.mode}: {info.name}</p>
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-violet-600 mt-2">
        Higher modes (3-8) lead to better learning outcomes than simply generating content (Mode 2).
      </p>
    </div>
  );
}
