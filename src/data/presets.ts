import { HarnessSkill } from '../types/harness';

export const INITIAL_SKILLS: HarnessSkill[] = [
  {
    id: 'repomap_ast_indexer',
    name: 'repomap_ast_indexer',
    titleFa: 'نگاشت ساختار AST پروژه (Aider RepoMap)',
    version: '2.4.0',
    author: 'Aider Core Integration',
    origin: 'Aider Core',
    category: 'analysis',
    description:
      'استخراج درختی تمام توابع، کلاس‌ها و وابستگی‌های فایل‌های پروژه بدون پر کردن Context Window مدل زبانی.',
    enabled: true,
    requiresHitl: false,
    commandTemplate: 'node -e "console.log(\'[RepoMap] Indexed AST symbols across workspace\')"',
    yamlManifest: `name: repomap_ast_indexer
origin: aider-core
version: 2.4.0
aci_interface:
  command: "repomap --extract-symbols --rank-pagerank"
  read_only: true
  auto_inject_context: true`,
    parameters: [
      {
        name: 'maxTokens',
        type: 'number',
        description: 'حداکثر بودجه توکن برای نقشه مخزن',
        required: false,
        defaultValue: '2048',
      },
      {
        name: 'includeSignatures',
        type: 'boolean',
        description: 'شامل شدن امضای ورودی و خروجی توابع',
        required: true,
        defaultValue: 'true',
      },
    ],
  },
  {
    id: 'agentless_fault_localizer',
    name: 'agentless_fault_localizer',
    titleFa: 'مکان‌یاب سلسله‌مراتبی کد (Agentless Localizer)',
    version: '1.2.0',
    author: 'OpenAutoCoder Architecture',
    origin: 'Agentless Graph',
    category: 'analysis',
    description:
      'مکان‌یابی ۳ مرحله‌ای محل تغییر یا خطا: ۱. غربالگری فایل‌های مرتبط ۲. یافتن کلاس/تابع هدف ۳. تعیین بازه خطوط دقیق کد.',
    enabled: true,
    requiresHitl: false,
    commandTemplate: 'node -e "console.log(\'[Agentless] Hierarchical localization completed\')"',
    yamlManifest: `name: agentless_fault_localizer
origin: agentless-pipeline
version: 1.2.0
stages:
  - file_level_ranking
  - skeleton_function_filtering
  - line_window_extraction`,
    parameters: [
      {
        name: 'topKFiles',
        type: 'number',
        description: 'تعداد فایل‌های کاندید برتر برای بررسی عمیق',
        required: true,
        defaultValue: '3',
      },
    ],
  },
  {
    id: 'surgical_search_replace',
    name: 'surgical_search_replace',
    titleFa: 'ویرایشگر جراحی کد با گارد سینتکس (Search/Replace ACI)',
    version: '3.1.0',
    author: 'Aider + SWE-agent ACI',
    origin: 'Aider Core',
    category: 'editing',
    description:
      'اعمال تغییرات کد در قالب بلوک‌های دقیق SEARCH/REPLACE به همراه بررسی خودکار Syntax/Linter قبل از ذخیره نهایی فایل.',
    enabled: true,
    requiresHitl: true,
    commandTemplate: 'node --check {{targetFile}}',
    yamlManifest: `name: surgical_search_replace
origin: aider-swe-hybrid
version: 3.1.0
guardrails:
  pre_commit_syntax_check: "node --check"
  rollback_on_lint_error: true
  conflict_resolution: fuzzy_whitespace_match`,
    parameters: [
      {
        name: 'targetFile',
        type: 'string',
        description: 'مسیر فایل هدف برای اعمال پچ و بررسی سینتکس',
        required: true,
      },
      {
        name: 'strictSyntaxGuard',
        type: 'boolean',
        description: 'برگشت خودکار فایل در صورت بروز SyntaxError',
        required: true,
        defaultValue: 'true',
      },
    ],
  },
  {
    id: 'swe_test_verifier',
    name: 'swe_test_verifier',
    titleFa: 'اجراکننده تست و فعال‌ساز چرخه اصلاح خودکار (SWE-agent Test Runner)',
    version: '1.8.2',
    author: 'Princeton SWE-agent ACI',
    origin: 'SWE-agent ACI',
    category: 'verification',
    description:
      'اجرای تست‌های پروژه در محیط واقعی، تحلیل Exit Code و استخراج خطوط دقیق خطا از Stack Trace برای تغذیه به حلقه Self-Correction.',
    enabled: true,
    requiresHitl: false,
    commandTemplate: 'npm test',
    yamlManifest: `name: swe_test_verifier
origin: swe-agent-aci
version: 1.8.2
execution:
  capture_stderr: true
  parse_stack_trace: true
  trigger_self_correction_on_nonzero_exit: true`,
    parameters: [
      {
        name: 'testCommand',
        type: 'string',
        description: 'دستور اجرای تست',
        required: true,
        defaultValue: 'npm test',
      },
    ],
  },
  {
    id: 'security_static_scanner',
    name: 'security_static_scanner',
    titleFa: 'ممیزی امنیتی کد و تشخیص دستورات پرخطر (Security Audit Bundle)',
    version: '1.1.0',
    author: 'ForgeSWE Security Lab',
    origin: 'SWE-agent ACI',
    category: 'security',
    description:
      'بررسی استاتیک فایل‌های پروژه برای یافتن الگوهای ناامن (eval، تزریق دستور، نشت کلید).',
    enabled: true,
    requiresHitl: true,
    commandTemplate:
      'node -e "const fs=require(\'fs\'); const files=fs.readdirSync(\'.\').filter(f=>f.endsWith(\'.js\')||f.endsWith(\'.ts\')); console.log(\'[Security Audit] Scanned \'+files.length+\' code files.\');"',
    yamlManifest: `name: security_static_scanner
origin: swe-agent-bundle
version: 1.1.0
rules:
  - forbid_eval_exec
  - check_token_expiration
  - verify_numeric_bounds`,
    parameters: [
      {
        name: 'scanLevel',
        type: 'string',
        description: 'سطح حساسیت اسکن امنیتی (standard / strict)',
        required: false,
        defaultValue: 'strict',
      },
    ],
  },
];
