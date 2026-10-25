import React, { useState, useEffect, useRef } from 'react';
import {
  HarnessPlan,
  HarnessSkill,
  HitlPolicy,
  PlanStep,
  RepoSymbolNode,
  SearchReplaceBlock,
  SelfCorrectionAttempt,
  TerminalEntry,
  WorkspaceState,
} from './types/harness';
import { INITIAL_SKILLS } from './data/presets';
import { HitlInspectionPanel } from './components/DiffViewerModal';
import { SkillsManagerView } from './components/SkillsManagerView';
import {
  Play,
  Terminal as TerminalIcon,
  FileCode,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Sliders,
  Plus,
  Save,
  GitCompare,
  Sparkles,
  ChevronLeft,
  FolderOpen,
  Upload,
  Trash2,
  Settings,
} from 'lucide-react';
import { ModelSettingsModal, ModelConfig } from './components/ModelSettingsModal';

type ActiveTab = 'workspace' | 'skills' | 'repomap';

declare global {
  interface Window {
    forgeDesktop?: {
      isDesktopApp: boolean;
      selectDirectory: () => Promise<string | null>;
    };
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('workspace');
  const [workspace, setWorkspace] = useState<WorkspaceState>({
    workspacePath: '/tmp/forgeswe-workspace',
    files: [],
  });
  const [selectedFilePath, setSelectedFilePath] = useState<string>('');
  const [editorContent, setEditorContent] = useState<string>('');
  const [showDiffMode, setShowDiffMode] = useState<boolean>(false);

  const [skills, setSkills] = useState<HarnessSkill[]>(INITIAL_SKILLS);
  const [repoMap, setRepoMap] = useState<RepoSymbolNode[]>([]);

  const [taskPrompt, setTaskPrompt] = useState<string>('');
  const [plan, setPlan] = useState<HarnessPlan | null>(null);
  const [isPlanning, setIsPlanning] = useState<boolean>(false);
  const [isExecutingLoop, setIsExecutingLoop] = useState<boolean>(false);
  const [isSelfCorrecting, setIsSelfCorrecting] = useState<boolean>(false);
  const [hitlPolicy, setHitlPolicy] = useState<HitlPolicy>('balanced');
  const [activeHitlStep, setActiveHitlStep] = useState<PlanStep | null>(null);
  const [selfCorrectionHistory, setSelfCorrectionHistory] = useState<SelfCorrectionAttempt[]>(
    []
  );

  const [modelConfig, setModelConfig] = useState<ModelConfig>({
    provider: 'gemini',
    modelName: 'gemini-3.8-flash',
    baseUrl: '',
    temperature: 0.2,
  });
  const [isModelSettingsOpen, setIsModelSettingsOpen] = useState<boolean>(false);

  const [terminalEntries, setTerminalEntries] = useState<TerminalEntry[]>([]);
  const [customCmd, setCustomCmd] = useState<string>('');
  const [newFileModal, setNewFileModal] = useState<boolean>(false);
  const [newFileName, setNewFileName] = useState<string>('');
  const [openDirModal, setOpenDirModal] = useState<boolean>(false);
  const [dirInputPath, setDirInputPath] = useState<string>('');
  const [statusBanner, setStatusBanner] = useState<{
    type: 'info' | 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);

  const terminalEndRef = useRef<HTMLDivElement | null>(null);
  const fileUploadInputRef = useRef<HTMLInputElement | null>(null);

  const selectedFile =
    workspace.files.find((f) => f.path === selectedFilePath) || workspace.files[0];

  // Bootstrap from backend server
  useEffect(() => {
    async function bootstrap() {
      try {
        const res = await fetch('/api/bootstrap');
        if (!res.ok) return;
        const data = await res.json();
        if (data.workspace) {
          setWorkspace(data.workspace);
          setDirInputPath(data.workspace.workspacePath);
          if (data.workspace.files.length > 0) {
            setSelectedFilePath(data.workspace.files[0].path);
            setEditorContent(data.workspace.files[0].content);
          }
        }
        if (data.repoMap) setRepoMap(data.repoMap);
        if (data.skills) setSkills(data.skills);
        if (data.modelConfig) setModelConfig(data.modelConfig);
        if (data.plans?.[0]) setPlan(data.plans[0]);
      } catch (e) {
        console.error('Bootstrap error:', e);
      }
    }
    bootstrap();
  }, []);

  const handleSaveModelConfig = async (newConfig: ModelConfig) => {
    try {
      const res = await fetch('/api/model/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig),
      });
      const data = await res.json();
      if (res.ok && data.config) {
        setModelConfig(data.config);
        setStatusBanner({
          type: 'success',
          text: `تنظیمات مدل با موفقیت بروزرسانی شد: ${data.config.modelName}${
            data.config.baseUrl ? ' (اندپوینت سفارشی)' : ''
          }`,
        });
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Sync editor content when switching selected file
  useEffect(() => {
    if (selectedFile) {
      setEditorContent(selectedFile.content);
      if (!selectedFilePath) {
        setSelectedFilePath(selectedFile.path);
      }
    } else {
      setEditorContent('');
    }
  }, [selectedFilePath, selectedFile?.content]);

  // Scroll terminal to bottom on new entry
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [terminalEntries]);

  const appendTerminal = (entry: Omit<TerminalEntry, 'id' | 'timestamp'>) => {
    setTerminalEntries((prev) => [
      ...prev,
      {
        ...entry,
        id: `term-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: new Date().toLocaleTimeString('fa-IR', { hour12: false }),
      },
    ]);
  };

  // Open local folder (via Electron native dialog on Windows OR path input)
  const handleOpenFolderDialog = async () => {
    if (window.forgeDesktop?.selectDirectory) {
      const chosen = await window.forgeDesktop.selectDirectory();
      if (chosen) {
        await switchWorkspaceDirectory(chosen);
      }
      return;
    }
    setOpenDirModal(!openDirModal);
  };

  const switchWorkspaceDirectory = async (targetPath: string) => {
    try {
      const res = await fetch('/api/workspace/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetPath }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatusBanner({ type: 'error', text: data.error || 'خطا در باز کردن پوشه' });
        return;
      }
      setWorkspace(data.workspace);
      setRepoMap(data.repoMap || []);
      setOpenDirModal(false);
      if (data.workspace.files.length > 0) {
        setSelectedFilePath(data.workspace.files[0].path);
        setEditorContent(data.workspace.files[0].content);
      } else {
        setSelectedFilePath('');
        setEditorContent('');
      }
      setStatusBanner({
        type: 'success',
        text: `پوشه کاری به ${data.workspace.workspacePath} تغییر یافت.`,
      });
    } catch (e) {
      console.error(e);
    }
  };

  // Import files from user's computer into active workspace
  const handleImportLocalFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    const importedFiles: Array<{ path: string; content: string }> = [];
    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i];
      if (f.size > 250 * 1024) continue;
      const text = await f.text();
      importedFiles.push({
        path: f.webkitRelativePath || f.name,
        content: text,
      });
    }

    if (importedFiles.length === 0) return;

    const res = await fetch('/api/workspace/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ importedFiles }),
    });
    if (res.ok) {
      const data = await res.json();
      setWorkspace(data.workspace);
      setRepoMap(data.repoMap || []);
      if (data.workspace.files.length > 0) {
        setSelectedFilePath(importedFiles[0].path);
      }
      setStatusBanner({
        type: 'success',
        text: `${importedFiles.length} فایل با موفقیت به پوشه کاری وارد شد.`,
      });
    }
    e.target.value = '';
  };

  // Execute a command in the real backend workspace
  const executeWorkspaceCommand = async (
    command: string,
    source: TerminalEntry['source'] = 'user',
    requiresApproval = false,
    approvalToken?: string
  ): Promise<{ stdout: string; stderr: string; exitCode: number; durationMs: number }> => {
    try {
      const res = await fetch('/api/workspace/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, requiresApproval, approvalToken }),
      });
      const data = await res.json();
      if (data.workspace) setWorkspace(data.workspace);
      if (data.repoMap) setRepoMap(data.repoMap);

      appendTerminal({
        command,
        stdout: data.stdout || '',
        stderr: data.stderr || '',
        exitCode: data.exitCode ?? 0,
        durationMs: data.durationMs ?? 12,
        source,
      });
      return data;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Execution error';
      appendTerminal({
        command,
        stdout: '',
        stderr: msg,
        exitCode: 1,
        durationMs: 10,
        source,
      });
      return { stdout: '', stderr: msg, exitCode: 1, durationMs: 10 };
    }
  };

  // Save direct human file edits to disk
  const handleSaveFile = async () => {
    if (!selectedFile) return;
    try {
      const res = await fetch('/api/workspace/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: selectedFile.path,
          content: editorContent,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setWorkspace(data.workspace);
        if (data.repoMap) setRepoMap(data.repoMap);
        setStatusBanner({
          type: 'success',
          text: `فایل ${selectedFile.path} در دیسک ذخیره شد.`,
        });
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Create a new file in the workspace
  const handleCreateNewFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFileName.trim()) return;
    const cleanName = newFileName.trim();
    const initialContent = '';
    const res = await fetch('/api/workspace/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filePath: cleanName,
        content: initialContent,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      setWorkspace(data.workspace);
      if (data.repoMap) setRepoMap(data.repoMap);
      setSelectedFilePath(cleanName);
      setEditorContent(initialContent);
      setNewFileModal(false);
      setNewFileName('');
    }
  };

  // Delete current file
  const handleDeleteFile = async (filePath: string) => {
    const res = await fetch('/api/workspace/file', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath }),
    });
    if (res.ok) {
      const data = await res.json();
      setWorkspace(data.workspace);
      if (data.repoMap) setRepoMap(data.repoMap);
      if (data.workspace.files.length > 0) {
        setSelectedFilePath(data.workspace.files[0].path);
        setEditorContent(data.workspace.files[0].content);
      } else {
        setSelectedFilePath('');
        setEditorContent('');
      }
    }
  };

  // Phase 1: Generate Multi-Step Plan (Aider Architect + Agentless Localizer)
  const handleGeneratePlan = async () => {
    if (!taskPrompt.trim()) {
      setStatusBanner({
        type: 'warning',
        text: 'لطفاً ابتدا شرح تسک برنامه‌نویسی خود را در کادر مربوطه وارد کنید.',
      });
      return;
    }

    setIsPlanning(true);
    setActiveHitlStep(null);
    setStatusBanner({
      type: 'info',
      text: 'در حال تحلیل ساختار AST پروژه و تولید نقشه گام‌به‌گام اجرایی (Planning)...',
    });

    try {
      const res = await fetch('/api/harness/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskPrompt }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatusBanner({
          type: 'error',
          text: data.error || 'خطا در تولید پلن اجرایی.',
        });
        return;
      }
      if (data.plan) {
        setPlan(data.plan);
        setStatusBanner({
          type: 'success',
          text: `پلن مهندسی شامل ${data.plan.steps.length} گام تولید شد.`,
        });
      }
    } catch (e) {
      console.error(e);
      setStatusBanner({
        type: 'error',
        text: 'خطا در ارتباط با سرور برای تولید پلن.',
      });
    } finally {
      setIsPlanning(false);
    }
  };

  // Trigger Automated Self-Correction Loop when a test/command fails ( up to 3 attempts )
  const triggerSelfCorrectionLoop = async (
    failedOutput: string,
    failedCommand: string,
    stepId?: string
  ): Promise<boolean> => {
    setIsSelfCorrecting(true);
    setStatusBanner({
      type: 'warning',
      text: 'بروز خطا در اجرای دستور/تست تشخیص داده شد. ورود خودکار به چرخه اصلاح خطا (Self-Correction)...',
    });

    if (stepId) {
      setPlan((prev) =>
        prev
          ? {
              ...prev,
              steps: prev.steps.map((s) =>
                s.id === stepId ? { ...s, status: 'self_correcting' } : s
              ),
            }
          : prev
      );
    }

    try {
      let currentError = failedOutput;
      let resolved = false;

      for (let attemptIdx = 1; attemptIdx <= 3; attemptIdx++) {
        const res = await fetch('/api/harness/self-correct', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            errorOutput: currentError,
            failedCommand,
          }),
        });
        const data = await res.json();
        if (!res.ok) break;

        if (data.workspace) setWorkspace(data.workspace);
        if (data.repoMap) setRepoMap(data.repoMap);

        appendTerminal({
          command: `[Self-Correction Attempt #${attemptIdx}] Re-Verifying (${failedCommand})`,
          stdout: data.testOutput || '',
          stderr: '',
          exitCode: data.testExitCode ?? 0,
          durationMs: 140,
          source: 'self-correction',
        });

        const attemptRecord: SelfCorrectionAttempt = {
          attemptNumber: selfCorrectionHistory.length + attemptIdx,
          timestamp: new Date().toLocaleTimeString('fa-IR', { hour12: false }),
          errorOutput: currentError.slice(0, 400),
          diagnosis: data.diagnosis || 'اصلاح خودکار بر اساس خروجی خطا انجام شد.',
          appliedPatch: data.appliedPatches?.[0] || {
            filePath: selectedFile?.path || 'index.js',
            search: '',
            replace: '',
          },
          testExitCode: data.testExitCode ?? 0,
          testOutput: data.testOutput || '',
          resolved: Boolean(data.resolved),
        };

        setSelfCorrectionHistory((prev) => [attemptRecord, ...prev]);

        if (data.resolved) {
          resolved = true;
          break;
        }
        currentError = data.testOutput || currentError;
      }

      if (stepId) {
        setPlan((prev) =>
          prev
            ? {
                ...prev,
                status: resolved ? 'completed' : 'failed',
                steps: prev.steps.map((s) =>
                  s.id === stepId
                    ? {
                        ...s,
                        status: resolved ? 'completed' : 'failed',
                        exitCode: resolved ? 0 : 1,
                      }
                    : s
                ),
              }
            : prev
        );
      }

      if (resolved) {
        setStatusBanner({
          type: 'success',
          text: 'چرخه اصلاح خودکار (Self-Correction) خطا را برطرف کرد و تست با Exit Code 0 پاس شد.',
        });
      } else {
        setStatusBanner({
          type: 'error',
          text: 'چرخه اصلاح خودکار پس از تلاش‌های متوالی نتوانست خطا را به طور کامل رفع کند. لطفاً کد را بررسی کنید.',
        });
      }
      return resolved;
    } catch (e) {
      console.error(e);
      if (stepId) {
        setPlan((prev) =>
          prev
            ? {
                ...prev,
                status: 'failed',
                steps: prev.steps.map((s) =>
                  s.id === stepId ? { ...s, status: 'failed', exitCode: 1 } : s
                ),
              }
            : prev
        );
      }
      setStatusBanner({
        type: 'error',
        text: 'چرخه اصلاح خودکار با خطا متوقف شد؛ پلن ناموفق است.',
      });
      return false;
    } finally {
      setIsSelfCorrecting(false);
    }
  };

  // Execute a single step of the Plan (respecting HITL policy)
  const executeSingleStep = async (
    step: PlanStep,
    bypassHitl = false,
    overridePatch?: SearchReplaceBlock,
    overrideCommand?: string
  ): Promise<boolean> => {
    const needsHitl =
      !bypassHitl &&
      (hitlPolicy === 'strict' ||
        (hitlPolicy === 'balanced' && (step.requiresApproval || step.type === 'edit')));

    if (needsHitl) {
      setActiveHitlStep(step);
      setPlan((prev) =>
        prev
          ? {
              ...prev,
              status: 'paused_hitl',
              steps: prev.steps.map((s) =>
                s.id === step.id ? { ...s, status: 'awaiting_hitl' } : s
              ),
            }
          : prev
      );
      setStatusBanner({
        type: 'warning',
        text: `توقف در ایستگاه نظارت انسانی (HITL) برای گام ${step.index}: «${step.title}».`,
      });
      return false;
    }

    setActiveHitlStep(null);
    setPlan((prev) =>
      prev
        ? {
            ...prev,
            status: 'running',
            steps: prev.steps.map((s) =>
              s.id === step.id ? { ...s, status: 'running' } : s
            ),
          }
        : prev
    );

    const startMs = Date.now();

    // Case A: File Creation / Surgical Edit Step (Aider SEARCH/REPLACE)
    if (step.type === 'edit' && (overridePatch || step.patch)) {
      const patchToApply = overridePatch || step.patch!;
      const res = await fetch('/api/hitl/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: `PATCH:${patchToApply.filePath}` }),
      });
      const approval = await res.json();
      if (!res.ok || !approval.approvalToken) {
        throw new Error(approval.error || 'HITL approval failed');
      }
      const resPatch = await fetch('/api/workspace/patch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patch: patchToApply, approvalToken: approval.approvalToken }),
      });
      const data = await resPatch.json();

      if (!resPatch.ok || !data.success) {
        const errMsg = data.error || data.syntaxCheckOutput || 'Patch failed';
        appendTerminal({
          command: `[Surgical Patch] ${patchToApply.filePath}`,
          stdout: '',
          stderr: errMsg,
          exitCode: 1,
          durationMs: Date.now() - startMs,
          source: 'harness',
        });
        const corrected = await triggerSelfCorrectionLoop(
          errMsg,
          `node --check "${patchToApply.filePath}"`,
          step.id
        );
        return corrected;
      }

      if (data.workspace) setWorkspace(data.workspace);
      if (data.repoMap) setRepoMap(data.repoMap);
      setSelectedFilePath(patchToApply.filePath);

      appendTerminal({
        command: `[Surgical Patch] Updated ${patchToApply.filePath} · ${data.syntaxCheckOutput}`,
        stdout: `Applied patch to ${patchToApply.filePath}\n${data.syntaxCheckOutput}`,
        stderr: '',
        exitCode: 0,
        durationMs: Date.now() - startMs,
        source: 'harness',
      });

      setPlan((prev) =>
        prev
          ? {
              ...prev,
              steps: prev.steps.map((s) =>
                s.id === step.id
                  ? {
                      ...s,
                      status: 'completed',
                      exitCode: 0,
                      durationMs: Date.now() - startMs,
                      patch: patchToApply,
                    }
                  : s
              ),
            }
          : prev
      );
      return true;
    }

    // Case B: Terminal Command / Test / Skill Execution
    const cmdToRun = overrideCommand || step.command || 'npm test';
    let commandApprovalToken: string | undefined;
    if (bypassHitl || step.requiresApproval || step.riskLevel === 'high') {
      const approvalResponse = await fetch('/api/hitl/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmdToRun }),
      });
      const approvalData = await approvalResponse.json();
      if (!approvalResponse.ok || !approvalData.approvalToken) {
        throw new Error(approvalData.error || 'HITL approval failed');
      }
      commandApprovalToken = approvalData.approvalToken;
    }
    const execResult = await executeWorkspaceCommand(
      cmdToRun,
      'harness',
      Boolean(commandApprovalToken),
      commandApprovalToken
    );

    if (execResult.exitCode !== 0) {
      const corrected = await triggerSelfCorrectionLoop(
        execResult.stdout + '\n' + execResult.stderr,
        cmdToRun,
        step.id
      );
      return corrected;
    }

    setPlan((prev) =>
      prev
        ? {
            ...prev,
            steps: prev.steps.map((s) =>
              s.id === step.id
                ? {
                    ...s,
                    status: 'completed',
                    exitCode: execResult.exitCode,
                    output: (execResult.stdout + '\n' + execResult.stderr).trim(),
                    durationMs: execResult.durationMs,
                  }
                : s
            ),
          }
        : prev
    );

    return true;
  };

  // Run or Resume the Plan Loop sequentially
  const handleRunOrResumePlan = async (startFromStepId?: string) => {
    if (!plan) return;
    setIsExecutingLoop(true);

    const stepsList = [...plan.steps];
    let shouldProcess = !startFromStepId;

    for (const step of stepsList) {
      if (startFromStepId && step.id === startFromStepId) {
        shouldProcess = true;
      }
      if (!shouldProcess) continue;
      if (step.status === 'completed' || step.status === 'skipped') continue;

      const completedWithoutPause = await executeSingleStep(step, false);
      if (!completedWithoutPause) {
        setIsExecutingLoop(false);
        return;
      }
    }

    const finalizationResponse = await fetch(`/api/harness/plan/${plan.id}/finalize`, {
      method: 'POST',
    });
    if (!finalizationResponse.ok) {
      setIsExecutingLoop(false);
      setStatusBanner({ type: 'error', text: 'تأیید نهایی پلن انجام نشد؛ وضعیت به‌عنوان موفق ثبت نشد.' });
      return;
    }
    const finalized = await finalizationResponse.json();
    setPlan(finalized.plan);
    setIsExecutingLoop(false);
    setStatusBanner({
      type: 'success',
      text: 'حلقه اجرایی هارنس با موفقیت به پایان رسید.',
    });
  };

  // Roll back files changed by the current plan to their initial snapshots.
  const handleRollbackPlan = async () => {
    if (!plan || !window.confirm('تمام تغییرات این پلن به وضعیت اولیه برگردد؟')) return;
    const response = await fetch(`/api/harness/plan/${plan.id}/rollback`, { method: 'POST' });
    const data = await response.json();
    if (!response.ok) {
      setStatusBanner({ type: 'error', text: data.error || 'Rollback انجام نشد.' });
      return;
    }
    if (data.workspace) setWorkspace(data.workspace);
    setPlan(data.plan);
    setStatusBanner({ type: 'success', text: 'تغییرات پلن به وضعیت اولیه بازگردانده شد.' });
  };

  // Approve HITL Step
  const handleApproveHitl = async (
    step: PlanStep,
    customPatch?: SearchReplaceBlock,
    customCommand?: string
  ) => {
    setIsExecutingLoop(true);
    const completed = await executeSingleStep(step, true, customPatch, customCommand);

    if (!completed) {
      setIsExecutingLoop(false);
      return;
    }

    if (plan) {
      const nextStep = plan.steps.find(
        (s) => s.index > step.index && s.status === 'pending'
      );
      if (nextStep) {
        await handleRunOrResumePlan(nextStep.id);
      } else {
        const finalizationResponse = await fetch(`/api/harness/plan/${plan.id}/finalize`, {
      method: 'POST',
    });
    if (!finalizationResponse.ok) {
      setIsExecutingLoop(false);
      setStatusBanner({ type: 'error', text: 'تأیید نهایی پلن انجام نشد؛ وضعیت به‌عنوان موفق ثبت نشد.' });
      return;
    }
    const finalized = await finalizationResponse.json();
    setPlan(finalized.plan);
        setIsExecutingLoop(false);
        setStatusBanner({
          type: 'success',
          text: 'تمامی گام‌های پلن اجرا شدند.',
        });
      }
    }
  };

  // Reject HITL Step
  const handleRejectHitl = (step: PlanStep, reason: string) => {
    setActiveHitlStep(null);
    setPlan((prev) =>
      prev
        ? {
            ...prev,
            status: 'ready',
            steps: prev.steps.map((s) =>
              s.id === step.id
                ? { ...s, status: 'skipped', output: `رد شده توسط ناظر: ${reason}` }
                : s
            ),
          }
        : prev
    );
    setStatusBanner({
      type: 'info',
      text: `گام ${step.index} توسط ناظر انسانی رد شد (${reason}).`,
    });
  };

  // Toggle Skill enabled/disabled
  const handleToggleSkill = async (skillId: string) => {
    const res = await fetch('/api/skills/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillId }),
    });
    if (res.ok) {
      const data = await res.json();
      setSkills(data.skills);
    }
  };

  // Add new custom Skill
  const handleAddSkill = async (skill: HarnessSkill) => {
    const res = await fetch('/api/skills/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skill }),
    });
    if (res.ok) {
      const data = await res.json();
      setSkills(data.skills);
      setStatusBanner({
        type: 'success',
        text: `اسکیل ماژولار «${skill.titleFa}» (${skill.name}) اضافه شد.`,
      });
    }
  };

  // Execute a Skill directly on the current workspace
  const handleExecuteSkill = async (skill: HarnessSkill) => {
    const cmd = skill.commandTemplate
      .replace('{{targetFile}}', selectedFile?.path || 'index.js')
      .replace('{{testCommand}}', 'npm test');
    setActiveTab('workspace');
    await executeWorkspaceCommand(cmd, 'skill');
    setStatusBanner({
      type: 'success',
      text: `اسکیل «${skill.titleFa}» روی محیط کاری اجرا شد.`,
    });
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-[#0B0F17] text-slate-100 overflow-hidden select-none">
      {/* STRICT 3-ZONE TOP BAR CONTRACT */}
      <header className="flex items-center justify-between gap-8 px-6 py-3.5 bg-[#0F1623] border-b border-slate-800 shrink-0">
        {/* Zone 1: Iconic animated NOVA HARNES brand mark */}
        <a
          href="#workspace"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('workspace');
          }}
          dir="ltr"
          className="group relative inline-flex items-center gap-2.5 whitespace-nowrap shrink-0 py-1 px-2 rounded-lg transition-all duration-300 hover:bg-slate-800/50"
        >
          <span className="relative flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500/20 via-blue-600/25 to-emerald-500/20 border border-cyan-400/30 shadow-sm transition-all duration-500 group-hover:scale-110 group-hover:rotate-12 group-hover:border-cyan-400/70 group-hover:shadow-cyan-500/25">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              className="w-4 h-4 text-cyan-400 transition-transform duration-500 group-hover:rotate-90 group-hover:text-emerald-300"
            >
              <path
                d="M12 2L14.6 9.4L22 12L14.6 14.6L12 22L9.4 14.6L2 12L9.4 9.4L12 2Z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="12" cy="12" r="2" fill="currentColor" />
            </svg>
          </span>
          <span className="text-lg font-extrabold tracking-wider bg-gradient-to-r from-cyan-300 via-blue-400 to-emerald-300 bg-clip-text text-transparent transition-all duration-300 group-hover:tracking-widest group-hover:from-emerald-300 group-hover:via-cyan-300 group-hover:to-blue-400">
            NOVA HARNES
          </span>
        </a>

        {/* Zone 2: Clean single-line navigation links */}
        <nav className="flex items-center gap-6 text-sm font-medium text-slate-400">
          <a
            href="#workspace"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('workspace');
            }}
            className={`hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              activeTab === 'workspace'
                ? 'text-slate-100 border-blue-500'
                : 'border-transparent'
            }`}
          >
            میز کار کدنویسی
          </a>
          <a
            href="#skills"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('skills');
            }}
            className={`hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              activeTab === 'skills'
                ? 'text-slate-100 border-blue-500'
                : 'border-transparent'
            }`}
          >
            مدیریت Skillها
          </a>
          <a
            href="#repomap"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('repomap');
            }}
            className={`hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              activeTab === 'repomap'
                ? 'text-slate-100 border-blue-500'
                : 'border-transparent'
            }`}
          >
            نقشه AST پروژه
          </a>
        </nav>

        {/* Zone 3: Model Settings & primary action */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => setIsModelSettingsOpen(true)}
            className="px-2.5 py-1.5 text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
            title="تنظیمات مدل هوش مصنوعی (نام مدل و Base URL)"
          >
            <Settings className="w-3.5 h-3.5 text-blue-400" />
            <span className="text-xs font-mono text-slate-300 hidden md:inline">
              {modelConfig.modelName}
            </span>
          </button>

          <button
            type="button"
            disabled={isPlanning || isExecutingLoop || isSelfCorrecting}
            onClick={() => {
              setActiveTab('workspace');
              handleGeneratePlan();
            }}
            className="px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-500 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            {isPlanning ? 'در حال تحلیل و پلنینگ...' : 'تحلیل تسک و تولید پلن'}
          </button>
        </div>
      </header>

      {/* Secondary Contextual Workspace Toolbar */}
      <div className="px-6 py-2.5 bg-[#0D131F] border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleOpenFolderDialog}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
          >
            <FolderOpen className="w-3.5 h-3.5 text-blue-400" />
            <span>باز کردن پوشه پروژه</span>
          </button>

          <input
            ref={fileUploadInputRef}
            type="file"
            multiple
            onChange={handleImportLocalFiles}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileUploadInputRef.current?.click()}
            className="px-3 py-1.5 bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-md text-xs flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
          >
            <Upload className="w-3.5 h-3.5 text-emerald-400" />
            <span>بارگذاری فایل از سیستم</span>
          </button>

          <span
            className="text-xs font-mono text-slate-400 bg-[#0B0F17] border border-slate-800 px-2.5 py-1 rounded truncate max-w-xs"
            dir="ltr"
            title={workspace.workspacePath}
          >
            {workspace.workspacePath}
          </span>
        </div>

        {/* Status Notification Strip */}
        {statusBanner && (
          <div className="text-xs text-slate-300 flex items-center gap-2 truncate max-w-xl">
            <span
              className={
                statusBanner.type === 'success'
                  ? 'text-emerald-400 font-medium'
                  : statusBanner.type === 'warning'
                  ? 'text-amber-400 font-medium'
                  : statusBanner.type === 'error'
                  ? 'text-red-400 font-medium'
                  : 'text-blue-400 font-medium'
              }
            >
              {statusBanner.text}
            </span>
          </div>
        )}

        {/* Right Controls: HITL Policy Selector */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <Sliders className="w-3.5 h-3.5 text-blue-400" />
            <span className="whitespace-nowrap">سطح نظارت انسانی (HITL):</span>
            <select
              value={hitlPolicy}
              onChange={(e) => setHitlPolicy(e.target.value as HitlPolicy)}
              className="bg-[#111827] border border-slate-700 rounded px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
            >
              <option value="balanced">هوشمند (توقف در ویرایش فایل و دستورات حساس)</option>
              <option value="strict">سخت‌گیرانه (تایید دستی تک‌تک گام‌ها)</option>
              <option value="autonomous">خودکار کامل (بدون توقف - Autonomous)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Directory Path Bar if opened in Web Mode */}
      {openDirModal && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            switchWorkspaceDirectory(dirInputPath);
          }}
          className="px-6 py-2.5 bg-[#111827] border-b border-blue-500/40 flex items-center justify-between gap-3 shrink-0"
        >
          <span className="text-xs text-slate-300 whitespace-nowrap">
            مسیر پوشه محلی روی سیستم را وارد کنید:
          </span>
          <input
            type="text"
            dir="ltr"
            value={dirInputPath}
            onChange={(e) => setDirInputPath(e.target.value)}
            placeholder="C:\Projects\my-app or /tmp/forgeswe-workspace"
            className="flex-1 bg-[#0B0F17] border border-slate-700 rounded px-3 py-1.5 text-xs font-mono text-slate-100 focus:outline-none focus:border-blue-500"
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded"
            >
              اتصال به پوشه
            </button>
            <button
              type="button"
              onClick={() => setOpenDirModal(false)}
              className="px-2.5 py-1.5 text-xs text-slate-400 hover:text-white"
            >
              بستن
            </button>
          </div>
        </form>
      )}

      {/* MAIN VIEWPORT CONTENT */}
      <main className="flex-1 overflow-hidden">
        {activeTab === 'skills' && (
          <SkillsManagerView
            skills={skills}
            onToggleSkill={handleToggleSkill}
            onAddSkill={handleAddSkill}
            onExecuteSkill={handleExecuteSkill}
          />
        )}

        {activeTab === 'repomap' && (
          <div className="h-full overflow-y-auto p-6 space-y-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div>
                <h2 className="text-base font-semibold text-slate-100">
                  نقشه درختی سمبل‌ها و AST پروژه (RepoMap)
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  ساختار استخراج‌شده از فایل‌های موجود در پوشه کاری فعلی ({workspace.workspacePath})
                </p>
              </div>
              <div className="text-xs text-slate-400 tabular-nums">
                <span>تعداد فایل‌ها: {repoMap.length}</span>
                <span aria-hidden="true"> · </span>
                <span>اسکیل‌های فعال: {skills.filter((s) => s.enabled).length}</span>
              </div>
            </div>

            {repoMap.length === 0 ? (
              <div className="bg-[#0F1623] border border-slate-800 rounded-lg p-8 text-center text-xs text-slate-400">
                هیچ فایلی در پوشه کاری فعلی وجود ندارد. یک فایل بسازید یا از سیستم بارگذاری کنید.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4" dir="ltr">
                {repoMap.map((node) => (
                  <div
                    key={node.filePath}
                    className="bg-[#0F1623] border border-slate-800 rounded-lg p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <span className="font-mono text-sm font-semibold text-blue-400 flex items-center gap-1.5">
                        <FileCode className="w-4 h-4" />
                        {node.filePath}
                      </span>
                      <span className="text-xs font-mono text-slate-400 tabular-nums">
                        {node.lineCount} lines
                      </span>
                    </div>

                    <div className="space-y-2 text-xs font-mono">
                      <div>
                        <span className="text-slate-500 block mb-1">Classes:</span>
                        {node.classes.length > 0 ? (
                          node.classes.map((c) => (
                            <div key={c} className="text-amber-300 pl-2">
                              class {c}
                            </div>
                          ))
                        ) : (
                          <span className="text-slate-600 pl-2">None</span>
                        )}
                      </div>

                      <div>
                        <span className="text-slate-500 block mb-1">Functions:</span>
                        {node.functions.length > 0 ? (
                          node.functions.map((fn) => (
                            <div key={fn} className="text-emerald-300 pl-2">
                              ƒ {fn}
                            </div>
                          ))
                        ) : (
                          <span className="text-slate-600 pl-2">None</span>
                        )}
                      </div>

                      <div>
                        <span className="text-slate-500 block mb-1">Imports / Requires:</span>
                        {node.imports.length > 0 ? (
                          node.imports.map((imp) => (
                            <div key={imp} className="text-slate-300 pl-2">
                              ↳ {imp}
                            </div>
                          ))
                        ) : (
                          <span className="text-slate-600 pl-2">None</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'workspace' && (
          <div className="h-full grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x lg:divide-x-reverse divide-slate-800 overflow-hidden">
            {/* RIGHT COLUMN (5 cols): Planning, HITL & Self-Correction Loop */}
            <div className="lg:col-span-5 h-full flex flex-col bg-[#0D131F] overflow-hidden">
              {/* Task Prompt Box */}
              <div className="p-4 border-b border-slate-800 space-y-3 shrink-0">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span className="font-medium text-slate-200">
                    تعریف تسک برنامه‌نویسی (Task Specification)
                  </span>
                  <span className="tabular-nums">
                    {skills.filter((s) => s.enabled).length} Skill فعال
                  </span>
                </div>

                <textarea
                  rows={3}
                  value={taskPrompt}
                  onChange={(e) => setTaskPrompt(e.target.value)}
                  className="w-full bg-[#0B0F17] border border-slate-700/80 rounded-lg p-3 text-xs text-slate-100 leading-relaxed focus:outline-none focus:border-blue-500 resize-none select-text"
                  placeholder="تسک مورد نظر خود را بنویسید (مثلاً: یک ماژول محاسبه اقساط بانکی در index.js به همراه تست واحد در test.js بنویس و تست‌ها را اجرا کن)..."
                />

                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    disabled={isPlanning || isExecutingLoop || isSelfCorrecting}
                    onClick={handleGeneratePlan}
                    className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{plan ? 'بازتولید پلن (Re-Plan)' : '۱. تحلیل و تولید پلن'}</span>
                  </button>

                  {plan && (
                    <button
                      type="button"
                      onClick={handleRollbackPlan}
                      className="px-3 py-1.5 bg-red-950/60 hover:bg-red-900/70 text-red-200 border border-red-800 rounded text-xs font-medium"
                    >
                      بازگردانی تغییرات (Rollback)
                    </button>
                  )}

                  {plan && (
                    <button
                      type="button"
                      disabled={isExecutingLoop || isSelfCorrecting || plan.status === 'completed'}
                      onClick={() => handleRunOrResumePlan()}
                      className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>
                        {plan.status === 'paused_hitl'
                          ? 'منتظر تایید HITL...'
                          : plan.status === 'completed'
                          ? 'پلن تکمیل شد'
                          : '۲. اجرای حلقه هارنس'}
                      </span>
                    </button>
                  )}
                </div>
              </div>

              {/* Scrollable Plan Steps, HITL Gate & Self-Correction Telemetry */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4 select-text">
                {!plan && !isPlanning && (
                  <div className="bg-[#111827] border border-slate-800 rounded-lg p-6 text-center space-y-2">
                    <div className="text-sm font-semibold text-slate-200">
                      هارنس آماده دریافت تسک است
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed max-w-md mx-auto">
                      تسک برنامه‌نویسی، ویرایش کد یا رفع باگ مورد نظر خود را در کادر بالا بنویسید و
                      دکمه <strong>«۱. تحلیل و تولید پلن»</strong> را بزنید تا هارنس مراحل کار را
                      طراحی و اجرا کند.
                    </p>
                  </div>
                )}

                {isPlanning && (
                  <div className="bg-[#111827] border border-slate-800 rounded-lg p-5 space-y-3 animate-pulse">
                    <div className="h-4 bg-slate-800 rounded w-2/3"></div>
                    <div className="h-3 bg-slate-800/70 rounded w-full"></div>
                    <div className="h-3 bg-slate-800/70 rounded-md w-5/6"></div>
                  </div>
                )}

                {/* Active HITL Approval & Direct Override Dock */}
                {activeHitlStep && (
                  <HitlInspectionPanel
                    step={activeHitlStep}
                    onApprove={handleApproveHitl}
                    onReject={handleRejectHitl}
                  />
                )}

                {/* Architect Summary & Plan Checklist */}
                {plan && (
                  <div className="space-y-3">
                    <div className="bg-[#111827] border border-slate-800 rounded-lg p-3.5 space-y-2">
                      <div className="flex items-center justify-between text-xs text-slate-400">
                        <span className="font-semibold text-blue-400">
                          خلاصه تحلیل معمار (Architect Plan)
                        </span>
                        <span className="font-mono tabular-nums">
                          {plan.localizedFiles.join(' · ')}
                        </span>
                      </div>
                      <p className="text-xs text-slate-300 leading-relaxed">
                        {plan.architectSummary}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs text-slate-400 px-1">
                        <span>گام‌های اجرایی پلن ({plan.steps.length} مرحله)</span>
                        <span>اجرای خودکار یا گام‌به‌گام</span>
                      </div>

                      {plan.steps.map((step) => {
                        const isCompleted = step.status === 'completed';
                        const isWaitingHitl = step.status === 'awaiting_hitl';
                        const isCorrecting = step.status === 'self_correcting';

                        return (
                          <div
                            key={step.id}
                            className={`p-3.5 rounded-lg border transition-colors ${
                              isWaitingHitl
                                ? 'bg-amber-950/20 border-amber-500/50'
                                : isCompleted
                                ? 'bg-[#0F172A] border-emerald-800/50'
                                : isCorrecting
                                ? 'bg-blue-950/30 border-blue-500/50'
                                : 'bg-[#111827] border-slate-800'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="space-y-1">
                                <div className="flex items-center gap-2 text-xs">
                                  <span className="font-mono font-semibold text-slate-400 tabular-nums">
                                    0{step.index}.
                                  </span>
                                  <span className="font-semibold text-slate-100">
                                    {step.title}
                                  </span>
                                </div>
                                <p className="text-xs text-slate-400 leading-relaxed">
                                  {step.description}
                                </p>

                                <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] text-slate-400">
                                  <span className="font-mono text-blue-300">
                                    نوع: {step.type.toUpperCase()}
                                  </span>
                                  {step.targetFile && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span className="font-mono text-slate-300">
                                        فایل: {step.targetFile}
                                      </span>
                                    </>
                                  )}
                                  {step.skillId && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span className="font-mono text-emerald-400">
                                        Skill: {step.skillId}
                                      </span>
                                    </>
                                  )}
                                  {typeof step.durationMs === 'number' && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span className="font-mono tabular-nums">
                                        {step.durationMs}ms
                                      </span>
                                    </>
                                  )}
                                </div>
                              </div>

                              <div className="flex flex-col items-end gap-1.5 shrink-0">
                                {isCompleted ? (
                                  <span className="text-xs text-emerald-400 flex items-center gap-1 font-medium whitespace-nowrap">
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    <span>انجام شد</span>
                                  </span>
                                ) : isWaitingHitl ? (
                                  <span className="text-xs text-amber-400 flex items-center gap-1 font-medium whitespace-nowrap">
                                    <AlertTriangle className="w-3.5 h-3.5" />
                                    <span>منتظر تایید HITL</span>
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    disabled={isExecutingLoop || isSelfCorrecting}
                                    onClick={() => executeSingleStep(step, false)}
                                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs font-medium transition-colors whitespace-nowrap"
                                  >
                                    اجرای گام
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Automated Self-Correction Loop Telemetry Log */}
                {selfCorrectionHistory.length > 0 && (
                  <div className="bg-[#111827] border border-emerald-500/40 rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>گزارش چرخه اصلاح خودکار (Self-Correction Loop)</span>
                      </span>
                      <span className="text-xs font-mono text-slate-400 tabular-nums">
                        {selfCorrectionHistory.length} اصلاح ثبت‌شده
                      </span>
                    </div>

                    {selfCorrectionHistory.map((item) => (
                      <div key={item.attemptNumber} className="space-y-2 text-xs">
                        <div className="text-slate-200 leading-relaxed">{item.diagnosis}</div>
                        <div
                          className="flex items-center justify-between text-[11px] font-mono text-emerald-300 bg-[#0B0F17] px-3 py-2 rounded border border-slate-800"
                          dir="ltr"
                        >
                          <span>Patched: {item.appliedPatch.filePath}</span>
                          <span>
                            Exit Code: {item.testExitCode} (
                            {item.resolved ? 'PASSED' : 'RETRYING'})
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* LEFT COLUMN (7 cols): Code Editor, Live Diff & Real Workspace Terminal */}
            <div className="lg:col-span-7 h-full flex flex-col bg-[#0B0F17] overflow-hidden">
              {/* File Tabs Header */}
              <div className="flex items-center justify-between px-4 py-2 bg-[#0F1623] border-b border-slate-800 shrink-0">
                <div className="flex items-center gap-1.5 overflow-x-auto" dir="ltr">
                  {workspace.files.map((file) => {
                    const isSelected = selectedFile && file.path === selectedFile.path;
                    const isModified = file.content !== file.originalContent;
                    return (
                      <div
                        key={file.path}
                        className={`group rounded-md text-xs font-mono flex items-center transition-colors whitespace-nowrap shrink-0 border ${
                          isSelected
                            ? 'bg-blue-600/20 text-blue-300 border-blue-500/50'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border-transparent'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedFilePath(file.path)}
                          className="px-2.5 py-1.5 flex items-center gap-1.5"
                        >
                          <FileCode className="w-3.5 h-3.5" />
                          <span>{file.path}</span>
                          {isModified && (
                            <span className="text-[10px] text-emerald-400 font-sans">●</span>
                          )}
                        </button>
                        {workspace.files.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleDeleteFile(file.path)}
                            className="pr-2 text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                            title="حذف فایل"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    );
                  })}

                  <button
                    type="button"
                    onClick={() => setNewFileModal(!newFileModal)}
                    className="px-2 py-1.5 text-xs text-slate-400 hover:text-white rounded hover:bg-slate-800 flex items-center gap-1 whitespace-nowrap shrink-0"
                    title="ایجاد فایل جدید"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowDiffMode(!showDiffMode)}
                    className={`px-2.5 py-1 rounded text-xs font-medium flex items-center gap-1.5 border transition-colors whitespace-nowrap shrink-0 ${
                      showDiffMode
                        ? 'bg-purple-950/60 border-purple-500/60 text-purple-200'
                        : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
                    }`}
                  >
                    <GitCompare className="w-3.5 h-3.5" />
                    <span>{showDiffMode ? 'بازگشت به ویرایشگر' : 'مقایسه Diff'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSaveFile}
                    className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                  >
                    <Save className="w-3.5 h-3.5 text-blue-400" />
                    <span>ذخیره فایل</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => executeWorkspaceCommand('npm test', 'user')}
                    className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>اجرای تست</span>
                  </button>
                </div>
              </div>

              {/* New file quick bar */}
              {newFileModal && (
                <form
                  onSubmit={handleCreateNewFile}
                  className="px-4 py-2 bg-[#111827] border-b border-slate-800 flex items-center gap-2"
                  dir="ltr"
                >
                  <input
                    type="text"
                    value={newFileName}
                    onChange={(e) => setNewFileName(e.target.value)}
                    placeholder="filename.js"
                    className="bg-[#0B0F17] border border-slate-700 rounded px-2.5 py-1 text-xs font-mono text-slate-100 focus:outline-none focus:border-blue-500"
                  />
                  <button
                    type="submit"
                    className="px-3 py-1 bg-blue-600 text-white text-xs rounded"
                  >
                    Create File
                  </button>
                </form>
              )}

              {/* Code Editor OR Side-by-Side Diff Viewer */}
              <div className="flex-1 min-h-0 overflow-hidden flex flex-col" dir="ltr">
                {selectedFile ? (
                  showDiffMode ? (
                    <div className="h-full grid grid-cols-2 divide-x divide-slate-800 overflow-y-auto bg-[#0B0F17]">
                      <div className="p-4 space-y-2">
                        <div className="text-xs font-mono text-slate-400 border-b border-slate-800 pb-1.5">
                          Initial Snapshot ({selectedFile.path})
                        </div>
                        <pre className="text-xs font-mono text-slate-400 leading-relaxed whitespace-pre-wrap select-text">
                          {selectedFile.originalContent}
                        </pre>
                      </div>
                      <div className="p-4 space-y-2 bg-emerald-950/5">
                        <div className="text-xs font-mono text-emerald-400 border-b border-slate-800 pb-1.5">
                          Current Modified ({selectedFile.path})
                        </div>
                        <pre className="text-xs font-mono text-emerald-200 leading-relaxed whitespace-pre-wrap select-text">
                          {editorContent}
                        </pre>
                      </div>
                    </div>
                  ) : (
                    <textarea
                      value={editorContent}
                      onChange={(e) => setEditorContent(e.target.value)}
                      spellCheck={false}
                      className="w-full h-full bg-[#0B0F17] text-slate-100 font-mono text-xs p-4 leading-relaxed focus:outline-none resize-none select-text"
                    />
                  )
                ) : (
                  <div className="h-full flex items-center justify-center text-xs text-slate-500">
                    فایلی انتخاب نشده است. با دکمه + یک فایل بسازید.
                  </div>
                )}
              </div>

              {/* Real Interactive Terminal Dock */}
              <div className="h-64 bg-[#080B11] border-t border-slate-800 flex flex-col shrink-0">
                <div className="px-4 py-2 bg-[#0F1623] border-b border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-slate-300">
                    <TerminalIcon className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="font-medium">ترمینال زنده پروژه (Terminal)</span>
                  </div>

                  <div className="flex items-center gap-2">
                    {selectedFile && selectedFile.path.endsWith('.js') && (
                      <button
                        type="button"
                        onClick={() =>
                          executeWorkspaceCommand(
                            `node --check "${selectedFile.path}"`,
                            'user'
                          )
                        }
                        className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[11px] font-mono transition-colors"
                      >
                        Syntax Check ({selectedFile.path})
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setTerminalEntries([])}
                      className="px-2 py-1 text-slate-400 hover:text-slate-200 text-[11px]"
                    >
                      پاکسازی
                    </button>
                  </div>
                </div>

                <div
                  className="flex-1 overflow-y-auto p-3.5 font-mono text-xs space-y-3 select-text"
                  dir="ltr"
                >
                  {terminalEntries.length === 0 ? (
                    <div className="text-slate-500 space-y-1">
                      <div>ForgeSWE Shell — Directory: {workspace.workspacePath}</div>
                      <div>Ready for commands (node, npm, git, python3)...</div>
                    </div>
                  ) : (
                    terminalEntries.map((entry) => (
                      <div
                        key={entry.id}
                        className="border-b border-slate-800/60 pb-2.5 space-y-1"
                      >
                        <div className="flex items-center justify-between text-[11px] text-slate-400">
                          <span className="text-blue-400 font-semibold">
                            $ {entry.command}
                          </span>
                          <span className="tabular-nums">
                            [{entry.source}] · Exit: {entry.exitCode} · {entry.durationMs}ms
                          </span>
                        </div>
                        {entry.stdout && (
                          <pre className="text-slate-200 whitespace-pre-wrap leading-relaxed">
                            {entry.stdout}
                          </pre>
                        )}
                        {entry.stderr && (
                          <pre className="text-red-400 whitespace-pre-wrap leading-relaxed">
                            {entry.stderr}
                          </pre>
                        )}
                      </div>
                    ))
                  )}
                  <div ref={terminalEndRef} />
                </div>

                {/* Direct Terminal Command Input */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!customCmd.trim()) return;
                    executeWorkspaceCommand(customCmd.trim(), 'user');
                    setCustomCmd('');
                  }}
                  className="px-3 py-2 bg-[#0B0F17] border-t border-slate-800/80 flex items-center gap-2"
                  dir="ltr"
                >
                  <ChevronLeft className="w-4 h-4 text-emerald-400 rotate-180 shrink-0" />
                  <input
                    type="text"
                    value={customCmd}
                    onChange={(e) => setCustomCmd(e.target.value)}
                    placeholder="Enter terminal command (e.g. node index.js, npm test, ls -la)..."
                    className="flex-1 bg-transparent text-xs font-mono text-slate-100 focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono rounded transition-colors"
                  >
                    Run
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Model Settings Modal */}
      <ModelSettingsModal
        isOpen={isModelSettingsOpen}
        onClose={() => setIsModelSettingsOpen(false)}
        config={modelConfig}
        onSave={handleSaveModelConfig}
      />
    </div>
  );
}
