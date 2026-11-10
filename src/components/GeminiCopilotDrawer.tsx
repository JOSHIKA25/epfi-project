import React, { useState, useRef, useEffect } from 'react';
import {
  Sparkles,
  Send,
  X,
  Bot,
  User,
  Activity,
  Layers,
  ShieldAlert,
  BookOpen,
  RotateCcw,
  CheckCircle2,
  FileText,
} from 'lucide-react';
import { ChatMessage, TelemetryPoint, FaultPrediction } from '../types/index.js';
import { api } from '../services/api.js';

interface GeminiCopilotDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  telemetry: TelemetryPoint | null;
  topPrediction?: FaultPrediction;
  anomalyScore?: number;
}

export const GeminiCopilotDrawer: React.FC<GeminiCopilotDrawerProps> = ({
  isOpen,
  onClose,
  telemetry,
  topPrediction,
  anomalyScore,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content:
        'Hello, Engineer. I am your Tennessee Eastman Process (TEP) AI Copilot, connected to live telemetry, prototype heuristic fault scores, sensor-attribution summaries, process-graph context, and the bundled engineering-document corpus. Fault scores are unvalidated and are not operational advice.\n\nHow can I assist with your plant operations or maintenance review?',
      timestamp: Date.now(),
    },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, isOpen]);

  const handleSend = async (textToSend?: string) => {
    const text = textToSend || inputValue;
    if (!text.trim() || isLoading) return;

    const userMsg: ChatMessage = {
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputValue('');
    setIsLoading(true);

    try {
      const reply = await api.sendGeminiChat(text, messages);
      setMessages((prev) => [...prev, reply]);
    } catch (err: any) {
      console.error('Error querying Gemini:', err);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content:
            'Telemetry inquiry failed to connect with the backend Gemini reasoning model. Please verify your backend server status.',
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const samplePrompts = [
    'Diagnose current plant anomaly',
    'Explain the heuristic sensor attributions',
    'What SOP should I follow for IDV-4?',
    'Check reactor MAWP safety limits',
    'Draft maintenance work order',
  ];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-full sm:w-[480px] bg-slate-900 border-l border-slate-800 shadow-2xl z-50 flex flex-col select-none text-slate-100">
      {/* Header */}
      <div className="p-4 border-b border-slate-800 bg-slate-950 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center text-slate-950 shadow-md">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              Gemini AI Plant Copilot
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
                gemini-3.8-flash
              </span>
            </h3>
            <div className="text-[11px] text-slate-400 font-sans">
              Tennessee Eastman Natural Language Reasoning
            </div>
          </div>
        </div>

        <button
          onClick={onClose}
          className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Live Digital Twin Telemetry Awareness Strip */}
      <div className="bg-slate-950/90 border-b border-slate-800/80 px-4 py-2 flex items-center justify-between text-[11px] font-mono text-slate-400">
        <div className="flex items-center gap-2 truncate">
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          <span>R-Temp: <strong className="text-white">{telemetry?.values['XMEAS_9']?.toFixed(1) ?? '120.4'}°C</strong></span>
          <span>•</span>
          <span>R-Press: <strong className="text-white">{telemetry?.values['XMEAS_7']?.toFixed(0) ?? '2705'} kPa</strong></span>
        </div>
        <div className="truncate">
          <span>Pred: <strong className="text-cyan-400">{topPrediction?.code || 'NORMAL'}</strong></span>
        </div>
      </div>

      {/* Messages Thread */}
      <div className="flex-1 p-4 overflow-y-auto space-y-4">
        {messages.map((msg, idx) => {
          const isUser = msg.role === 'user';
          return (
            <div
              key={idx}
              className={`flex gap-3 text-xs leading-relaxed ${
                isUser ? 'flex-row-reverse' : ''
              }`}
            >
              {/* Avatar */}
              <div
                className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold shadow-sm ${
                  isUser
                    ? 'bg-slate-700 text-slate-200'
                    : 'bg-cyan-600 text-slate-950'
                }`}
              >
                {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
              </div>

              {/* Message Content Bubble */}
              <div
                className={`max-w-[85%] rounded-xl p-3 shadow-md font-sans ${
                  isUser
                    ? 'bg-cyan-600 text-white font-medium'
                    : 'bg-slate-950 border border-slate-800 text-slate-200'
                }`}
              >
                {/* Content text formatted */}
                <div className="whitespace-pre-line">{msg.content}</div>

                {/* Grounding Source Badges */}
                {msg.groundingSources && msg.groundingSources.length > 0 && (
                  <div className="mt-3 pt-2.5 border-t border-slate-800 space-y-1.5">
                    <span className="text-[10px] font-mono text-cyan-400 font-bold block uppercase tracking-wider">
                      Digital Twin Grounding Evidence:
                    </span>
                    {msg.groundingSources.map((src, sIdx) => (
                      <div
                        key={sIdx}
                        className="p-1.5 rounded bg-slate-900 border border-slate-800 text-[10px] font-mono flex items-start gap-1.5"
                      >
                        <span className="px-1 py-0.2 rounded bg-slate-950 text-cyan-300 border border-slate-800 uppercase text-[9px]">
                          {src.type}
                        </span>
                        <div>
                          <strong className="text-white block">{src.title}</strong>
                          <span className="text-slate-400">{src.details}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {isLoading && (
          <div className="flex gap-3 text-xs">
            <div className="w-7 h-7 rounded-lg bg-cyan-600 flex items-center justify-center text-slate-950 animate-pulse">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-400 flex items-center gap-2 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
              <span>Analyzing live TEP sensor telemetry & ML weights...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick Prompts Bar */}
      <div className="px-4 py-2 border-t border-slate-800 bg-slate-950/70 overflow-x-auto scrollbar-none flex items-center gap-1.5">
        {samplePrompts.map((p, idx) => (
          <button
            key={idx}
            onClick={() => handleSend(p)}
            className="text-[11px] whitespace-nowrap px-2.5 py-1 rounded-full bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 transition cursor-pointer"
          >
            {p}
          </button>
        ))}
      </div>

      {/* Input Box */}
      <div className="p-3 border-t border-slate-800 bg-slate-950 flex items-center gap-2">
        <input
          type="text"
          placeholder="Ask Gemini about live sensors, prototype fault scores, or SOPs..."
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-sans"
        />

        <button
          onClick={() => handleSend()}
          disabled={!inputValue.trim() || isLoading}
          className={`p-2 rounded-lg transition cursor-pointer ${
            inputValue.trim() && !isLoading
              ? 'bg-cyan-500 hover:bg-cyan-400 text-slate-950'
              : 'bg-slate-800 text-slate-600 cursor-not-allowed'
          }`}
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
