import React, { useState, useEffect } from 'react';
import { PlanStep, SearchReplaceBlock } from '../types/harness';
import { Check, X, Edit3, ShieldAlert, Terminal, FileCode } from 'lucide-react';

interface HitlInspectionPanelProps {
  step: PlanStep;
  onApprove: (step: PlanStep, customPatch?: SearchReplaceBlock, customCommand?: string) => void;
  onReject: (step: PlanStep, reason: string) => void;
}

export const HitlInspectionPanel: React.FC<HitlInspectionPanelProps> = ({
  step,
  onApprove,
  onReject,
}) => {
  const [isEditingOverride, setIsEditingOverride] = useState(false);
  const [editedReplace, setEditedReplace] = useState(step.patch?.replace || '');
  const [editedSearch, setEditedSearch] = useState(step.patch?.search || '');
  const [editedCommand, setEditedCommand] = useState(step.command || '');
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);

  useEffect(() => {
    setEditedReplace(step.patch?.replace || '');
    setEditedSearch(step.patch?.search || '');
    setEditedCommand(step.command || '');
    setIsEditingOverride(false);
    setShowRejectInput(false);
  }, [step]);

  const handleConfirm = () => {
    if (step.patch) {
      onApprove(
        step,
        {
          ...step.patch,
          search: editedSearch,
          replace: editedReplace,
        },
        undefined
      );
    } else {
      onApprove(step, undefined, editedCommand);
    }
  };

  return (
    <div className="bg-[#111827] border border-amber-500/40 rounded-lg p-4 space-y-4">
      <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-amber-400 text-xs font-medium">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>ایستگاه نظارت انسانی (Human-in-the-Loop Gate)</span>
            <span aria-hidden="true">·</span>
            <span>گام {step.index}: نیازمند تایید یا ویرایش مستقیم</span>
          </div>
          <h4 className="text-sm font-semibold text-slate-100">{step.title}</h4>
          <p className="text-xs text-slate-400 leading-relaxed">{step.description}</p>
        </div>

        <button
          type="button"
          onClick={() => setIsEditingOverride(!isEditingOverride)}
          className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
            isEditingOverride
              ? 'bg-blue-600/20 border-blue-500 text-blue-300'
              : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:text-white'
          }`}
        >
          <Edit3 className="w-3.5 h-3.5" />
          <span>{isEditingOverride ? 'در حال ویرایش مستقیم' : 'ویرایش مستقیم کد / دستور'}</span>
        </button>
      </div>

      {/* Aider-style SEARCH / REPLACE Diff Inspection */}
      {step.patch ? (
        <div className="space-y-3" dir="ltr">
          <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
            <span className="flex items-center gap-1.5 text-slate-200">
              <FileCode className="w-3.5 h-3.5 text-blue-400" />
              {step.patch.filePath}
            </span>
            <span>Aider Surgical SEARCH / REPLACE Block</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {/* SEARCH BLOCK (Before) */}
            <div className="bg-[#0B0F17] border border-red-900/50 rounded-md overflow-hidden">
              <div className="bg-red-950/40 px-3 py-1.5 border-b border-red-900/40 flex items-center justify-between text-[11px] font-mono text-red-300">
                <span>{'<<<<<<< SEARCH (کد فعلی دارای باگ)'}</span>
                <span>حذف / جایگزینی</span>
              </div>
              {isEditingOverride ? (
                <textarea
                  value={editedSearch}
                  onChange={(e) => setEditedSearch(e.target.value)}
                  rows={8}
                  className="w-full bg-[#0B0F17] text-red-200 font-mono text-xs p-3 focus:outline-none resize-y"
                />
              ) : (
                <pre className="p-3 text-xs font-mono text-red-200/90 overflow-x-auto leading-relaxed whitespace-pre">
                  {editedSearch}
                </pre>
              )}
            </div>

            {/* REPLACE BLOCK (After) */}
            <div className="bg-[#0B0F17] border border-emerald-900/50 rounded-md overflow-hidden">
              <div className="bg-emerald-950/40 px-3 py-1.5 border-b border-emerald-900/40 flex items-center justify-between text-[11px] font-mono text-emerald-300">
                <span>{'>>>>>>> REPLACE (کد اصلاح‌شده جدید)'}</span>
                <span>{isEditingOverride ? 'قابل ویرایش مستقیم توسط شما' : 'پیشنهاد هارنس'}</span>
              </div>
              {isEditingOverride ? (
                <textarea
                  value={editedReplace}
                  onChange={(e) => setEditedReplace(e.target.value)}
                  rows={8}
                  className="w-full bg-[#0B0F17] text-emerald-200 font-mono text-xs p-3 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-y"
                />
              ) : (
                <pre className="p-3 text-xs font-mono text-emerald-200/90 overflow-x-auto leading-relaxed whitespace-pre">
                  {editedReplace}
                </pre>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-2" dir="ltr">
          <div className="flex items-center gap-1.5 text-xs text-slate-400 font-mono">
            <Terminal className="w-3.5 h-3.5 text-amber-400" />
            <span>Terminal Command Execution</span>
          </div>
          {isEditingOverride ? (
            <input
              type="text"
              value={editedCommand}
              onChange={(e) => setEditedCommand(e.target.value)}
              className="w-full bg-[#0B0F17] border border-blue-500/60 rounded px-3 py-2 text-xs font-mono text-slate-100 focus:outline-none"
            />
          ) : (
            <div className="bg-[#0B0F17] border border-slate-800 rounded px-3 py-2 text-xs font-mono text-amber-300">
              $ {editedCommand}
            </div>
          )}
        </div>
      )}

      {/* Reject feedback input if opened */}
      {showRejectInput && (
        <div className="flex items-center gap-2 pt-1">
          <input
            type="text"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="دلیل رد شدن یا دستورالعمل اصلاحی برای ایجنت را بنویسید..."
            className="flex-1 bg-[#0B0F17] border border-slate-700 rounded-md px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-red-500"
          />
          <button
            type="button"
            onClick={() => onReject(step, rejectReason || 'رد شده توسط ناظر انسانی')}
            className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-xs font-medium rounded-md whitespace-nowrap shrink-0"
          >
            ثبت رد مرحله
          </button>
        </div>
      )}

      {/* Action Controls */}
      <div className="flex items-center justify-between gap-3 pt-2">
        <div className="text-xs text-slate-400">
          <span>سطح ریسک: </span>
          <span className="text-amber-300 font-medium">
            {step.riskLevel === 'high' ? 'بالا (حساس)' : 'متوسط (تغییر کد)'}
          </span>
          <span aria-hidden="true"> · </span>
          <span>گارد سینتکس SWE-agent فعال است</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowRejectInput(!showRejectInput)}
            className="px-3 py-1.5 bg-slate-800 hover:bg-red-950/60 text-slate-300 hover:text-red-300 border border-slate-700 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <X className="w-3.5 h-3.5" />
            <span>رد کردن (Reject)</span>
          </button>

          <button
            type="button"
            onClick={handleConfirm}
            className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Check className="w-3.5 h-3.5" />
            <span>
              {isEditingOverride
                ? 'تایید و اعمال نسخه ویرایش‌شده'
                : 'تایید و اجرای گام (Approve)'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
