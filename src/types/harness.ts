export type StepType = 'analyze' | 'edit' | 'command' | 'test' | 'skill';
export type StepStatus =
  | 'pending'
  | 'running'
  | 'awaiting_hitl'
  | 'self_correcting'
  | 'completed'
  | 'failed'
  | 'skipped';

export type RiskLevel = 'low' | 'medium' | 'high';

export interface SearchReplaceBlock {
  filePath: string;
  search: string;
  replace: string;
  explanation?: string;
}

export interface SelfCorrectionAttempt {
  attemptNumber: number;
  timestamp: string;
  errorOutput: string;
  diagnosis: string;
  appliedPatch: SearchReplaceBlock;
  testExitCode: number;
  testOutput: string;
  resolved: boolean;
}

export interface PlanStep {
  id: string;
  index: number;
  title: string;
  description: string;
  type: StepType;
  targetFile?: string;
  command?: string;
  skillId?: string;
  skillArgs?: Record<string, string>;
  patch?: SearchReplaceBlock;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  status: StepStatus;
  output?: string;
  exitCode?: number;
  durationMs?: number;
  selfCorrections?: SelfCorrectionAttempt[];
}

export interface HarnessPlan {
  id: string;
  taskPrompt: string;
  createdAt: string;
  architectSummary: string;
  localizedFiles: string[];
  steps: PlanStep[];
  status: 'idle' | 'planning' | 'ready' | 'running' | 'paused_hitl' | 'completed' | 'failed';
}

export interface RepoSymbolNode {
  filePath: string;
  language: string;
  lineCount: number;
  classes: string[];
  functions: string[];
  imports: string[];
}

export interface WorkspaceFile {
  path: string;
  name: string;
  language: string;
  content: string;
  originalContent: string;
  lastModified: string;
}

export interface WorkspaceState {
  workspacePath: string;
  files: WorkspaceFile[];
}

export interface SkillParameter {
  name: string;
  type: 'string' | 'number' | 'boolean';
  description: string;
  required: boolean;
  defaultValue?: string;
}

export interface HarnessSkill {
  id: string;
  name: string;
  titleFa: string;
  version: string;
  author: string;
  origin: 'SWE-agent ACI' | 'Aider Core' | 'Agentless Graph' | 'Custom Skill';
  category: 'analysis' | 'editing' | 'verification' | 'security' | 'git';
  description: string;
  enabled: boolean;
  requiresHitl: boolean;
  commandTemplate: string;
  yamlManifest: string;
  parameters: SkillParameter[];
}

export interface TerminalEntry {
  id: string;
  timestamp: string;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  source: 'user' | 'harness' | 'self-correction' | 'skill';
}

export type HitlPolicy = 'strict' | 'balanced' | 'autonomous';
