import React, { useState, useEffect } from 'react';
import {
  X,
  Check,
  Cpu,
  Globe,
  KeyRound,
  Sparkles,
  Eye,
  EyeOff,
  Activity,
  Server,
} from 'lucide-react';

export type ModelProviderType = 'openai-compatible' | 'gemini';

export interface ModelConfig {
  provider: ModelProviderType;
  modelName: string;
  baseUrl: string;
  apiKey?: string;
  hasCustomKey?: boolean;
  maskedKey?: string;
  temperature: number;
}

interface ModelSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: ModelConfig;
  onSave: (newConfig: ModelConfig) => Promise<void>;
}

const PROVIDER_PRESETS: Array<{
  id: string;
  label: string;
  provider: ModelProviderType;
  baseUrl: string;
  defaultModel: string;
}> = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    provider: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'anthropic/claude-3.5-sonnet',
  },
  {
    id: 'openai',
    label: 'OpenAI Official',
    provider: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek API',
    provider: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
  },
  {
    id: 'ollama',
    label: 'Ollama / Local LLM',
    provider: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'qwen2.5-coder:14b',
  },
  {
    id: 'gemini',
    label: 'Google Gemini SDK',
    provider: 'gemini',
    baseUrl: '',
    defaultModel: 'gemini-3.8-flash',
  },
];

export const ModelSettingsModal: React.FC<ModelSettingsModalProps> = ({
  isOpen,
  onClose,
  config,
  onSave,
}) => {
  const [provider, setProvider] = useState<ModelProviderType>(
    config.provider || 'gemini'
  );
  const [modelName, setModelName] = useState(config.modelName || 'gemini-3.8-flash');
  const [baseUrl, setBaseUrl] = useState(config.baseUrl || '');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [temperature, setTemperature] = useState(config.temperature ?? 0.2);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    if (isOpen) {
      setProvider(config.provider || 'gemini');
      setModelName(config.modelName || 'gemini-3.8-flash');
      setBaseUrl(config.baseUrl || '');
      setApiKey('');
      setTemperature(config.temperature ?? 0.2);
      setTestResult(null);
    }
  }, [isOpen, config]);

  if (!isOpen) return null;

  const handleApplyPreset = (preset: (typeof PROVIDER_PRESETS)[0]) => {
    setProvider(preset.provider);
    setBaseUrl(preset.baseUrl);
    setModelName(preset.defaultModel);
    setTestResult(null);
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/model/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          modelName: modelName.trim(),
          baseUrl: baseUrl.trim(),
          apiKey: apiKey.trim() || undefined,
          temperature: Number(temperature),
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setTestResult({
          ok: true,
          message: data.message || 'اتصال به مدل با موفقیت برقرار شد.',
        });
      } else {
        setTestResult({
          ok: false,
          message: data.error || 'خطا در اتصال به سرویس مدل.',
        });
      }
    } catch (err: unknown) {
      setTestResult({
        ok: false,
        message: err instanceof Error ? err.message : 'خطا در برقراری ارتباط.',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await onSave({
        provider,
        modelName: modelName.trim() || 'gemini-3.8-flash',
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim() ? apiKey.trim() : undefined,
        temperature: Number(temperature),
      });
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 select-none">
      <div className="bg-[#111827] border border-slate-700/80 rounded-xl w-full max-w-xl overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-blue-400" />
            <h3 className="text-sm font-semibold text-slate-100">
              تنظیمات اتصال مدل و پروایدر (Model & Provider Configuration)
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="p-5 space-y-4">
          {/* Quick Provider Presets */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300 block">
              انتخاب سریع پروایدر (Presets):
            </label>
            <div className="flex flex-wrap gap-1.5" dir="ltr">
              {PROVIDER_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleApplyPreset(preset)}
                  className={`text-xs px-2.5 py-1 rounded-md border font-mono transition-colors ${
                    provider === preset.provider && baseUrl === preset.baseUrl
                      ? 'bg-blue-600/20 text-blue-300 border-blue-500/60'
                      : 'bg-[#0B0F17] text-slate-400 hover:text-slate-200 border-slate-800'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Protocol / Provider Type */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-200 flex items-center gap-1.5">
                <Server className="w-3.5 h-3.5 text-purple-400" />
                <span>ساختار پروتکل API</span>
              </label>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value as ModelProviderType)}
                className="w-full bg-[#0B0F17] border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
              >
                <option value="openai-compatible">
                  OpenAI-Compatible (/v1/chat/completions)
                </option>
                <option value="gemini">Google Gemini SDK</option>
              </select>
            </div>

            {/* Model Name */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-200 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                <span>نام مدل (Model Name)</span>
              </label>
              <input
                type="text"
                required
                dir="ltr"
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                placeholder="e.g. gpt-4o, claude-3-5-sonnet, gemini-3.8-flash"
                className="w-full bg-[#0B0F17] border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-slate-100 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* Base URL */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-200 flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-emerald-400" />
              <span>آدرس سرویس (Base URL)</span>
            </label>
            <input
              type="text"
              dir="ltr"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={
                provider === 'openai-compatible'
                  ? 'https://openrouter.ai/api/v1 یا https://api.openai.com/v1'
                  : 'اختیاری (خالی = آدرس پیش‌فرض گوگل)'
              }
              className="w-full bg-[#0B0F17] border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-slate-100 focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* API Key Input */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-slate-200 flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5 text-amber-400" />
                <span>کلید دسترسی (API Key)</span>
              </label>
              {config.hasCustomKey && (
                <span className="text-[11px] font-mono text-emerald-400" dir="ltr">
                  Active Key: {config.maskedKey}
                </span>
              )}
            </div>

            <div className="relative" dir="ltr">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  config.hasCustomKey
                    ? 'کلید قبلی ذخیره شده است (برای تغییر، کلید جدید وارد کنید)'
                    : 'sk-... / AIza...'
                }
                className="w-full bg-[#0B0F17] border border-slate-700 rounded-lg pl-3 pr-9 py-2 text-xs font-mono text-slate-100 focus:outline-none focus:border-blue-500"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                title={showKey ? 'مخفی کردن کلید' : 'نمایش کلید'}
              >
                {showKey ? (
                  <EyeOff className="w-3.5 h-3.5" />
                ) : (
                  <Eye className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              می‌توانید کلید هر پروایدر (OpenRouter، OpenAI، DeepSeek، کلید شخصی Gemini و غیره) را وارد کنید. در صورت خالی گذاشتن در حالت Gemini، از کلید پیش‌فرض محیط سرور استفاده می‌شود.
            </p>
          </div>

          {/* Temperature */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-200">
                دمای پاسخ‌دهی (Temperature)
              </span>
              <span className="font-mono text-blue-400 tabular-nums">{temperature}</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value))}
              className="w-full accent-blue-500 cursor-pointer"
            />
          </div>

          {/* Test Result Banner */}
          {testResult && (
            <div
              className={`rounded-lg px-3.5 py-2.5 text-xs border ${
                testResult.ok
                  ? 'bg-emerald-950/40 border-emerald-700/60 text-emerald-300'
                  : 'bg-red-950/40 border-red-700/60 text-red-300'
              }`}
            >
              {testResult.message}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-800">
            <button
              type="button"
              disabled={isTesting}
              onClick={handleTestConnection}
              className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 border border-slate-700 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors"
            >
              <Activity className="w-3.5 h-3.5 text-emerald-400" />
              <span>{isTesting ? 'در حال تست اتصال...' : 'تست اتصال به مدل'}</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
              >
                انصراف
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors"
              >
                <Check className="w-3.5 h-3.5" />
                <span>{isSaving ? 'در حال ذخیره...' : 'ذخیره و اعمال'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
