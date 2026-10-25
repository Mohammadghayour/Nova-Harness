import React, { useState } from 'react';
import { HarnessSkill } from '../types/harness';
import { Plus, Play, Power, Code2, Shield, CheckCircle2, Layers } from 'lucide-react';

interface SkillsManagerViewProps {
  skills: HarnessSkill[];
  onToggleSkill: (skillId: string) => void;
  onAddSkill: (skill: HarnessSkill) => void;
  onExecuteSkill: (skill: HarnessSkill) => void;
}

export const SkillsManagerView: React.FC<SkillsManagerViewProps> = ({
  skills,
  onToggleSkill,
  onAddSkill,
  onExecuteSkill,
}) => {
  const [selectedSkillId, setSelectedSkillId] = useState<string>(skills[0]?.id || '');
  const [showCreateForm, setShowCreateForm] = useState(false);

  // New Skill form state
  const [newName, setNewName] = useState('');
  const [newTitleFa, setNewTitleFa] = useState('');
  const [newCategory, setNewCategory] = useState<HarnessSkill['category']>('analysis');
  const [newDescription, setNewDescription] = useState('');
  const [newCommand, setNewCommand] = useState(
    'node -e "console.log(\'[Custom Skill] Executed successfully on workspace\')"'
  );
  const [newRequiresHitl, setNewRequiresHitl] = useState(false);

  const selectedSkill = skills.find((s) => s.id === selectedSkillId) || skills[0];

  const handleCreateSkill = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newTitleFa.trim()) return;

    const cleanId = newName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_');

    const created: HarnessSkill = {
      id: cleanId,
      name: cleanId,
      titleFa: newTitleFa.trim(),
      version: '1.0.0',
      author: 'User Custom Bundle',
      origin: 'Custom Skill',
      category: newCategory,
      description:
        newDescription.trim() || 'اسکیل سفارشی اضافه‌شده به موتور اجرایی هارنس کدنویسی.',
      enabled: true,
      requiresHitl: newRequiresHitl,
      commandTemplate: newCommand.trim(),
      yamlManifest: `name: ${cleanId}
origin: custom-aci-bundle
version: 1.0.0
requires_hitl: ${newRequiresHitl}
execution:
  command: "${newCommand.trim().replace(/"/g, '\\"')}"`,
      parameters: [
        {
          name: 'targetScope',
          type: 'string',
          description: 'محدوده فایل‌های هدف در پروژه',
          required: false,
          defaultValue: './*',
        },
      ],
    };

    onAddSkill(created);
    setSelectedSkillId(created.id);
    setShowCreateForm(false);
    setNewName('');
    setNewTitleFa('');
    setNewDescription('');
  };

  return (
    <div className="h-full flex flex-col lg:flex-row gap-6 p-6 overflow-y-auto">
      {/* Left Column: List of Modular Skills */}
      <div className="w-full lg:w-7/12 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              مخزن ماژولار مهارت‌ها (SWE-agent ACI Tool Bundles)
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              قابلیت بارگذاری داینامیک ابزارهای جدید در حلقه برنامه‌ریزی و اجرای هارنس
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>افزودن Skill جدید</span>
          </button>
        </div>

        {/* Create New Skill Form */}
        {showCreateForm && (
          <form
            onSubmit={handleCreateSkill}
            className="bg-[#111827] border border-blue-500/40 rounded-lg p-4 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-xs font-semibold text-blue-300">
                تعریف و بارگذاری Skill ماژولار جدید در هارنس
              </span>
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="text-xs text-slate-400 hover:text-slate-200"
              >
                انصراف
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-300 mb-1">
                  شناسه فنی ابزار (انگلیسی - مثل dependency_auditor)
                </label>
                <input
                  type="text"
                  required
                  dir="ltr"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="dependency_auditor"
                  className="w-full bg-[#0B0F17] border border-slate-700 rounded px-3 py-1.5 text-xs font-mono text-slate-100 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-300 mb-1">عنوان فارسی Skill</label>
                <input
                  type="text"
                  required
                  value={newTitleFa}
                  onChange={(e) => setNewTitleFa(e.target.value)}
                  placeholder="بررسی‌کننده وابستگی‌ها و پکیج‌ها"
                  className="w-full bg-[#0B0F17] border border-slate-700 rounded px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-300 mb-1">دسته‌بندی عملکرد</label>
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as HarnessSkill['category'])}
                  className="w-full bg-[#0B0F17] border border-slate-700 rounded px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                >
                  <option value="analysis">تحلیل کد و ساختار (Analysis)</option>
                  <option value="editing">ویرایش و ریفکتورینگ (Editing)</option>
                  <option value="verification">تست و اعتبارسنجی (Verification)</option>
                  <option value="security">امنیت و ممیزی (Security)</option>
                  <option value="git">کنترل نسخه (Git)</option>
                </select>
              </div>

              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newRequiresHitl}
                    onChange={(e) => setNewRequiresHitl(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-900 text-blue-600"
                  />
                  <span>نیازمند تایید نظارت انسانی (HITL) قبل از اجرا</span>
                </label>
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-300 mb-1">
                دستور اجرایی در ترمینال (Command Template)
              </label>
              <input
                type="text"
                dir="ltr"
                value={newCommand}
                onChange={(e) => setNewCommand(e.target.value)}
                className="w-full bg-[#0B0F17] border border-slate-700 rounded px-3 py-1.5 text-xs font-mono text-emerald-300 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-300 mb-1">
                توضیحات راهنمای مدل زبانی (Prompt Description)
              </label>
              <textarea
                rows={2}
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="توضیح دهید ایجنت در چه مواقعی باید این Skill را فراخوانی کند..."
                className="w-full bg-[#0B0F17] border border-slate-700 rounded px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-md transition-colors"
              >
                ثبت و تزریق به هسته هارنس
              </button>
            </div>
          </form>
        )}

        {/* Skills Table / List */}
        <div className="space-y-2.5">
          {skills.map((skill) => {
            const isSelected = skill.id === selectedSkill?.id;
            return (
              <div
                key={skill.id}
                onClick={() => setSelectedSkillId(skill.id)}
                className={`p-4 rounded-lg border transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-[#131C2E] border-blue-500/60'
                    : 'bg-[#0F1623] border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <span className="font-mono text-blue-400 font-medium">{skill.name}</span>
                      <span aria-hidden="true">·</span>
                      <span>{skill.origin}</span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">v{skill.version}</span>
                      {skill.requiresHitl && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-amber-400">حساس (HITL)</span>
                        </>
                      )}
                    </div>
                    <h3 className="text-sm font-semibold text-slate-100">{skill.titleFa}</h3>
                    <p className="text-xs text-slate-400 leading-relaxed">{skill.description}</p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onExecuteSkill(skill);
                      }}
                      className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs font-medium flex items-center gap-1 transition-colors whitespace-nowrap shrink-0"
                      title="اجرای مستقیم این Skill روی پروژه فعلی"
                    >
                      <Play className="w-3 h-3 text-emerald-400" />
                      <span>تست اجرا</span>
                    </button>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleSkill(skill.id);
                      }}
                      className={`px-2.5 py-1.5 rounded text-xs font-medium flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                        skill.enabled
                          ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/60'
                          : 'bg-slate-800/60 text-slate-500 border border-slate-800'
                      }`}
                    >
                      <Power className="w-3 h-3" />
                      <span>{skill.enabled ? 'فعال' : 'غیرفعال'}</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right Column: Selected Skill ACI Manifest & Schema Inspector */}
      {selectedSkill && (
        <div className="w-full lg:w-5/12 bg-[#0F1623] border border-slate-800 rounded-lg p-5 space-y-5 h-fit">
          <div className="border-b border-slate-800 pb-3 space-y-1">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-blue-400" />
                <span>مشخصات فنی باندل (SWE-agent Tool Bundle)</span>
              </span>
              <span className="font-mono tabular-nums">{selectedSkill.id}</span>
            </div>
            <h3 className="text-base font-semibold text-slate-100">{selectedSkill.titleFa}</h3>
          </div>

          <div className="space-y-2" dir="ltr">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="flex items-center gap-1.5 font-mono">
                <Code2 className="w-3.5 h-3.5 text-emerald-400" />
                config.yaml (ACI Manifest)
              </span>
              <span className="font-mono text-[11px] text-slate-500">{selectedSkill.author}</span>
            </div>
            <pre className="bg-[#0B0F17] border border-slate-800 rounded-md p-3.5 text-xs font-mono text-slate-200 overflow-x-auto leading-relaxed">
              {selectedSkill.yamlManifest}
            </pre>
          </div>

          <div className="space-y-2" dir="ltr">
            <div className="text-xs font-mono text-slate-400">Execution Command Template</div>
            <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-3 text-xs font-mono text-amber-300 break-all">
              $ {selectedSkill.commandTemplate}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-medium text-slate-300">
              پارامترهای ورودی مدل زبانی (Tool Call Schema)
            </div>
            <div className="border border-slate-800 rounded-md divide-y divide-slate-800 bg-[#0B0F17]">
              {selectedSkill.parameters.map((param) => (
                <div key={param.name} className="p-3 flex items-start justify-between gap-4">
                  <div className="space-y-0.5">
                    <div className="text-xs font-mono text-blue-300">{param.name}</div>
                    <div className="text-xs text-slate-400">{param.description}</div>
                  </div>
                  <div className="text-xs font-mono text-slate-400 shrink-0" dir="ltr">
                    {param.type} {param.defaultValue ? `= ${param.defaultValue}` : ''}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
            <span className="flex items-center gap-1.5">
              {selectedSkill.requiresHitl ? (
                <>
                  <Shield className="w-3.5 h-3.5 text-amber-400" />
                  <span>توقف در ایستگاه نظارت انسانی (HITL)</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>اجرای خودکار بدون توقف (Read-Only / Safe)</span>
                </>
              )}
            </span>

            <button
              type="button"
              onClick={() => onExecuteSkill(selectedSkill)}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-medium transition-colors"
            >
              اجرای اکنون در ترمینال
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
