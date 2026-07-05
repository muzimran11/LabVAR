// ---------------------------------------------------------------------------
// ollamaClient.ts — Frontend client for local Ollama LLM.
//
// Talks directly to the Ollama HTTP API at localhost:11434. Used by the AI
// Chart Builder to generate Python/R plotting code from user descriptions.
//
// Recommended models (in order of quality for code generation):
//   qwen2.5-coder:7b  — best code model at this size, fast on M-series Macs
//   deepseek-coder:6.7b — strong alternative
//   codellama:7b       — decent fallback
//   phi3:mini          — NOT recommended for code (leaks prose into output)
// ---------------------------------------------------------------------------

export interface OllamaConfig {
  baseUrl: string;
  model: string;
}

export const DEFAULT_OLLAMA_CONFIG: OllamaConfig = {
  baseUrl: 'http://localhost:11434',
  model: 'qwen2.5-coder:3b',
};

/** Models we recommend for code generation, shown in Settings UI. */
export const RECOMMENDED_MODELS = [
  { value: 'qwen2.5-coder:3b', label: 'Qwen 2.5 Coder 3B (default)' },
  { value: 'qwen2.5-coder:7b', label: 'Qwen 2.5 Coder 7B (better quality, needs more RAM)' },
  { value: 'deepseek-coder:6.7b', label: 'DeepSeek Coder 6.7B' },
  { value: 'codellama:7b', label: 'Code Llama 7B' },
] as const;

export type PlotLanguage = 'python' | 'r';

/** Temp path for chart output — don't clutter the user's data folder. */
export const TEMP_CHART_OUTPUT = '/tmp/labvar_ai_chart.png';

/**
 * Detect whether column names follow a "N Hours Treatment" pattern
 * (e.g. "0 Hours Control", "24 Hours FUDR 12.5uM").
 * When true, boilerplate will split Condition into Time + Treatment columns.
 */
export function detectTimeTreatment(columns: string[]): boolean {
  if (columns.length < 4) return false;
  return columns.every((c) => /^\d+\s*Hours?\s/i.test(c));
}

export interface ChartRequest {
  /** Single user prompt describing the chart */
  context: string;
  /** Color scheme preference */
  colorScheme: string;
  /** Python or R */
  language: PlotLanguage;
  /** Full path to the CSV file on disk */
  csvPath: string;
  /** Directory containing the CSV (so model knows where to write output) */
  csvDir: string;
  /** First ~20 rows of the CSV for the model to understand the data shape */
  csvPreview: string;
  /** Column names from the CSV */
  columns: string[];
  /** Optional: previous code that needs correction */
  previousCode?: string;
  /** Optional: what to fix about the previous attempt */
  correctionNote?: string;
  /** Optional: model's interpretation of the data from phase 1 */
  dataInterpretation?: string;
}

const INTERPRET_PROMPT = `You are a data analyst. Look at this CSV preview and describe in 2-3 SHORT sentences:
1. What the data measures (the biological/scientific context).
2. What each column represents.
3. What the numeric values are (units if obvious).
Be concise. No bullet points. Plain English only.`;

const SYSTEM_PROMPT = `You write ONLY executable code. No English text. No markdown fences. Every line must be valid syntax.

The data is ALREADY loaded into df_long with columns: Condition (string, categorical), Value (float, numeric measurements).
- Condition contains the original column headers as category labels.
- Value contains the numeric data points. Value is ALWAYS numeric — never filter it as a string.
The boilerplate (imports, CSV read, melt, output_path) is prepended for you. Do NOT re-import or re-read the CSV.

YOUR JOB: Write ONLY the plotting code.
- ALWAYS use seaborn for grouped plots: sns.boxplot(x='Condition', y='Value', data=df_long), sns.barplot, sns.violinplot, sns.stripplot, sns.swarmplot.
- NEVER use plt.boxplot or plt.bar with df_long — they do not accept long-format DataFrames.
- Use df_long['Condition'] for grouping/x-axis. Use df_long['Value'] for y-axis.
- If Time and Treatment columns exist, prefer Treatment for x-axis and Time for hue.
- plt.tight_layout() then plt.savefig(output_path, dpi=150, bbox_inches='tight').
- When correcting code, fix ONLY what was asked.`;

/**
 * Detect whether the CSV is wide-format (all columns are numeric measurements
 * with structured names like "0 Hours Control", "24 Hours FUDR 50uM").
 */
export function isWideFormat(columns: string[], preview: string): boolean {
  const lines = preview.split('\n').filter((l) => l.trim());
  if (lines.length < 2) return false;
  const dataRow = lines[1].split(',').map((v) => v.trim());
  // Wide if ≥80% of columns with data are numeric
  let numericCount = 0;
  let nonEmpty = 0;
  dataRow.forEach((v) => {
    if (v !== '') {
      nonEmpty++;
      if (!isNaN(Number(v))) numericCount++;
    }
  });
  return nonEmpty > 0 && numericCount / nonEmpty >= 0.8 && columns.length >= 3;
}

/**
 * Generate the boilerplate code that loads the CSV, melts it into long format,
 * and sets up the output path. The model only writes the plotting part.
 */
export function generateBoilerplate(
  csvPath: string,
  _csvDir: string,
  _columns: string[],
  language: PlotLanguage,
  wide: boolean,
): string {
  const hasTimeTreatment = wide && detectTimeTreatment(_columns);

  if (language === 'r') {
    const numConditions = wide ? _columns.length : 0;
    const figWidth = Math.max(10, numConditions * 1.2);
    const lines = [
      'library(ggplot2)',
      'library(readr)',
      'library(tidyr)',
      'library(stringr)',
      '',
      `df <- read_csv("${csvPath}")`,
    ];
    if (wide) {
      lines.push(
        `df_long <- pivot_longer(df, cols = everything(), names_to = "Condition", values_to = "Value", values_drop_na = TRUE)`,
      );
    } else {
      lines.push('df_long <- df');
    }
    if (hasTimeTreatment) {
      lines.push(`df_long$Time <- paste0(str_extract(df_long$Condition, "^\\\\d+"), " h")`);
      lines.push(`df_long$Treatment <- str_trim(str_replace(df_long$Condition, "^\\\\d+\\\\s*Hours?\\\\s*", ""))`);
      lines.push(`df_long$Treatment[df_long$Treatment == ""] <- "Control"`);
    }
    lines.push(`output_path <- "${TEMP_CHART_OUTPUT}"`);
    lines.push(`png(output_path, width = ${Math.round(figWidth * 100)}, height = 600, res = 150)`);
    lines.push('print(head(df_long))');
    lines.push('');
    return lines.join('\n');
  }

  // Python
  const numConditions = wide ? _columns.length : 0;
  const figWidth = Math.max(10, numConditions * 1.2);
  const lines = [
    'import pandas as pd',
    'import matplotlib.pyplot as plt',
    'import seaborn as sns',
    'import numpy as np',
    'import re',
    'import traceback',
    '',
    `plt.figure(figsize=(${figWidth}, 6))`,
    `df = pd.read_csv("${csvPath}")`,
    'print(df.columns.tolist())',
  ];
  if (wide) {
    lines.push(
      `df_long = df.melt(var_name='Condition', value_name='Value').dropna()`,
    );
  } else {
    lines.push('df_long = df');
  }
  if (hasTimeTreatment) {
    lines.push(`df_long['Time'] = df_long['Condition'].str.extract(r'^(\\d+)\\s*Hours?', flags=re.IGNORECASE)[0] + ' h'`);
    lines.push(`df_long['Treatment'] = df_long['Condition'].str.replace(r'^\\d+\\s*Hours?\\s*', '', regex=True).str.strip()`);
    lines.push(`df_long.loc[df_long['Treatment'] == '', 'Treatment'] = 'Control'`);
  }
  lines.push(`output_path = "${TEMP_CHART_OUTPUT}"`);
  lines.push('print(df_long.head())');
  // Readable x-labels: rotate if many or long condition names
  if (wide && numConditions >= 4) {
    lines.push(`plt.xticks(rotation=45, ha='right')`);
  }
  lines.push('');
  return lines.join('\n');
}

function buildUserPrompt(req: ChartRequest): string {
  const parts: string[] = [];
  const wide = isWideFormat(req.columns, req.csvPreview);
  const hasTime = wide && detectTimeTreatment(req.columns);

  if (req.previousCode && req.correctionNote) {
    parts.push(`CORRECTION: ${req.correctionNote}`);
    parts.push(`\nPREVIOUS CODE:\n${req.previousCode}`);
    const cols = wide
      ? hasTime ? 'Condition, Value, Time, Treatment' : 'Condition, Value'
      : req.columns.join(', ');
    parts.push(`\ndf_long has columns: ${cols}`);
    parts.push(`output_path is already set. Write ONLY the plotting code.`);
  } else {
    const lang = req.language === 'python' ? 'Python' : 'R';
    parts.push(`Write ${lang} plotting code. Output ONLY code — no imports, no CSV reading.`);
    parts.push(`\nThe data is already loaded into df_long.`);
    if (wide) {
      if (hasTime) {
        parts.push(`df_long columns: Condition, Value, Time, Treatment`);
        // Derive unique times and treatments for context
        const times = [...new Set(req.columns.map((c) => c.match(/^(\d+)\s*Hours?/i)?.[1]).filter(Boolean))];
        const treatments = [...new Set(req.columns.map((c) => c.replace(/^\d+\s*Hours?\s*/i, '').trim() || 'Control'))];
        parts.push(`Time values: ${times.map((t) => `"${t} h"`).join(', ')}`);
        parts.push(`Treatment values: ${treatments.map((t) => `"${t}"`).join(', ')}`);
        parts.push(`Use Treatment for x-axis and Time for hue/color grouping.`);
      } else {
        parts.push(`df_long columns: Condition, Value`);
        parts.push(`Condition values: ${req.columns.map((c) => `"${c}"`).join(', ')}`);
      }
    } else {
      parts.push(`df_long columns: ${req.columns.join(', ')}`);
    }
    parts.push(`output_path is already set.`);
    if (req.dataInterpretation) {
      parts.push(`\nData context (from analysis): ${req.dataInterpretation}`);
    }
    parts.push(`\n${req.context}`);
    if (req.colorScheme !== 'default') parts.push(`Colors: ${req.colorScheme}`);
  }

  return parts.join('\n');
}

/**
 * Extract executable code from the model response.
 * 1. Strips markdown fences.
 * 2. Removes duplicate imports (boilerplate already has them).
 * 3. Removes prose lines that aren't valid Python/R.
 */
export function extractCode(raw: string): string {
  let code = raw;

  // Strip markdown fences
  const fenceMatch = code.match(/```(?:python|r|py)?\s*\n([\s\S]*?)```/i);
  if (fenceMatch) {
    code = fenceMatch[1];
  }

  // Line-by-line sanitization — remove obvious prose and duplicate imports
  const seenImports = new Set<string>();
  const cleaned = code
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      // Keep blank lines (they're structural in Python)
      if (!trimmed) return true;
      // Dedup imports — the boilerplate already has them
      if (/^(import |from |library\()/.test(trimmed)) {
        if (seenImports.has(trimmed)) return false;
        seenImports.add(trimmed);
      }
      // Keep comments
      if (trimmed.startsWith('#') || trimmed.startsWith('//')) return true;
      // Keep lines that start with valid code tokens
      if (/^(import |from |def |class |if |elif |else:|else |for |while |try:|except|finally:|with |return |raise |print|plt\.|sns\.|pd\.|df|fig|ax|np\.|os\.|sys\.|  |	|\w+\s*[=\[(]|[)\]},]|@|"""|\.\w|library\(|require\(|ggplot|ggsave|theme|geom_|aes\(|labs\(|scale_|read|write|source|suppressMessages|options\(|cat\(|paste)/.test(trimmed)) {
        return true;
      }
      // If it contains = or ( or ) and has no spaces-only-words pattern, probably code
      if (/[=()[\]{}<>+\-*/|&!]/.test(trimmed) && trimmed.length < 200) return true;
      // Lines starting with a quote (string literal) are fine
      if (/^["'`]/.test(trimmed)) return true;
      // Kill lines that look like English prose (3+ consecutive words, no operators)
      if (/^[A-Z][a-z]+ [a-z]+ [a-z]+/.test(trimmed) && !/[=()[\]{}:,]/.test(trimmed)) {
        return false;
      }
      // Default: keep it (let the interpreter catch actual errors)
      return true;
    })
    .join('\n')
    .trim();

  return cleaned;
}

/**
 * Fix common matplotlib misuse with long-format data.
 * The 3B model often writes plt.boxplot/plt.bar which don't handle df_long.
 * Rewrite to seaborn equivalents that do.
 */
export function patchPlotCalls(code: string, language: 'python' | 'r'): string {
  if (language !== 'python') return code;

  // plt.boxplot(df_long['Value'], labels=df_long['Condition']) → sns.boxplot(...)
  code = code.replace(
    /plt\.boxplot\s*\([^)]*df_long\[['"]Value['"]\][^)]*\)/g,
    "sns.boxplot(x='Condition', y='Value', data=df_long)",
  );

  // plt.bar(df_long['Condition'], df_long['Value']...) → sns.barplot(...)
  code = code.replace(
    /plt\.bar\s*\(\s*df_long\[['"]Condition['"]\]\s*,\s*df_long\[['"]Value['"]\][^)]*\)/g,
    "sns.barplot(x='Condition', y='Value', data=df_long)",
  );

  return code;
}

/**
 * Auto-inject missing imports that the model forgot.
 * Scans the code for usage of common libraries and prepends any missing imports.
 */
export function patchImports(code: string, language: 'python' | 'r'): string {
  if (language === 'r') {
    const needs: string[] = [];
    if (/ggplot|geom_|aes\(|theme/.test(code) && !/library\(ggplot2\)/.test(code))
      needs.push('library(ggplot2)');
    if (/read_csv|read_tsv/.test(code) && !/library\(readr\)/.test(code))
      needs.push('library(readr)');
    if (/melt|dcast/.test(code) && !/library\(reshape2\)/.test(code))
      needs.push('library(reshape2)');
    return needs.length ? needs.join('\n') + '\n\n' + code : code;
  }

  // Python
  const needs: string[] = [];
  if (/\bpd\./.test(code) && !/import pandas/.test(code))
    needs.push('import pandas as pd');
  if (/\bplt\./.test(code) && !/import matplotlib/.test(code))
    needs.push('import matplotlib.pyplot as plt');
  if (/\bsns\./.test(code) && !/import seaborn/.test(code))
    needs.push('import seaborn as sns');
  if (/\bnp\./.test(code) && !/import numpy/.test(code))
    needs.push('import numpy as np');
  if (/\bos\./.test(code) && !/import os/.test(code))
    needs.push('import os');
  if (/\btraceback\./.test(code) && !/import traceback/.test(code))
    needs.push('import traceback');

  return needs.length ? needs.join('\n') + '\n\n' + code : code;
}

/**
 * Check if Ollama is reachable and the model is available.
 */
export async function checkOllama(config: OllamaConfig = DEFAULT_OLLAMA_CONFIG): Promise<{
  online: boolean;
  modelAvailable: boolean;
  models: string[];
}> {
  try {
    const res = await fetch(`${config.baseUrl}/api/tags`);
    if (!res.ok) return { online: false, modelAvailable: false, models: [] };
    const data = await res.json();
    const models: string[] = (data.models ?? []).map((m: { name: string }) => m.name);
    const modelAvailable = models.some((m) => m.startsWith(config.model.split(':')[0]));
    return { online: true, modelAvailable, models };
  } catch {
    return { online: false, modelAvailable: false, models: [] };
  }
}

/**
 * Generate chart code via Ollama (non-streaming — simpler for now).
 * Returns the full response text.
 */
export async function generateChartCode(
  req: ChartRequest,
  config: OllamaConfig = DEFAULT_OLLAMA_CONFIG,
  onToken?: (partial: string) => void,
): Promise<string> {
  const body = {
    model: config.model,
    system: SYSTEM_PROMPT,
    prompt: buildUserPrompt(req),
    stream: true,
    options: {
      temperature: 0.3, // Low temp for code generation
      num_predict: 2048,
    },
  };

  const res = await fetch(`${config.baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Ollama returned ${res.status}: ${errText}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body from Ollama');

  const decoder = new TextDecoder();
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    // Ollama streams newline-delimited JSON
    for (const line of chunk.split('\n')) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.response) {
          full += obj.response;
          onToken?.(full);
        }
      } catch {
        // partial JSON, skip
      }
    }
  }

  return full;
}

/**
 * Two-phase generation: first ask the model to interpret the CSV data,
 * then use that interpretation as additional context for code generation.
 * Returns a short plain-English description of the data.
 */
export async function interpretData(
  csvPreview: string,
  config: OllamaConfig = DEFAULT_OLLAMA_CONFIG,
): Promise<string> {
  const body = {
    model: config.model,
    system: INTERPRET_PROMPT,
    prompt: `CSV preview:\n${csvPreview}`,
    stream: false,
    options: {
      temperature: 0.2,
      num_predict: 256,
    },
  };

  const res = await fetch(`${config.baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    // Non-critical — fall back to no interpretation
    return '';
  }

  const data = await res.json();
  return (data.response ?? '').trim();
}

/** Color scheme options for the dropdown. */
export const COLOR_SCHEMES = [
  { value: 'default', label: 'Default' },
  { value: 'viridis', label: 'Viridis' },
  { value: 'plasma', label: 'Plasma' },
  { value: 'inferno', label: 'Inferno' },
  { value: 'magma', label: 'Magma' },
  { value: 'cividis', label: 'Cividis' },
  { value: 'Set1', label: 'Set1 (categorical)' },
  { value: 'Set2', label: 'Set2 (categorical)' },
  { value: 'Pastel1', label: 'Pastel1' },
  { value: 'Dark2', label: 'Dark2' },
  { value: 'tab10', label: 'Tab10' },
  { value: 'Paired', label: 'Paired' },
  { value: 'Blues', label: 'Blues (sequential)' },
  { value: 'Reds', label: 'Reds (sequential)' },
  { value: 'Greens', label: 'Greens (sequential)' },
  { value: 'coolwarm', label: 'Coolwarm (diverging)' },
  { value: 'RdYlGn', label: 'Red-Yellow-Green' },
  { value: 'grayscale', label: 'Grayscale' },
] as const;
