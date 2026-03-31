/**
 * Shared Ollama Utilities - OpenAI Compatible
 *
 * DRY: Shared between pi-ollama extension and internal app usage
 * Uses OpenAI-compatible endpoints (/v1) for pi-coding-agent compatibility
 */

// Logging helpers
const DEBUG = process.env.PI_OLLAMA_DEBUG === 'true';

export function debug(...args: any[]) {
  if (DEBUG) console.debug('[pi-ollama]', ...args);
}

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface OllamaConfig {
  baseUrl: string;
  cloudUrl: string;
  apiKey: string | undefined;
}

export const DEFAULT_CONFIG: OllamaConfig = {
  baseUrl: 'http://localhost:11434',
  cloudUrl: 'https://ollama.com',
  apiKey: undefined,
};

/**
 * Load config from environment variables
 */
export function loadConfigFromEnv(): Partial<OllamaConfig> {
  return {
    baseUrl: process.env.OLLAMA_BASE_URL,
    cloudUrl: process.env.OLLAMA_CLOUD_URL,
    apiKey: process.env.OLLAMA_API_KEY,
  };
}

// ============================================================================
// CLIENT MANAGEMENT
// ============================================================================

export interface OllamaClients {
  local: { baseUrl: string; apiKey?: string };
  cloud: { baseUrl: string; apiKey?: string } | null;
  hasApiKey: boolean;
}

/**
 * Create Ollama clients based on config
 * Returns config objects for fetch-based API calls
 */
export function createClients(config: Partial<OllamaConfig> = {}): OllamaClients {
  const merged = { ...DEFAULT_CONFIG, ...config };

  const local = {
    baseUrl: merged.baseUrl.replace(/\/$/, ''), // Remove trailing slash
    apiKey: undefined,
  };

  const cloud = merged.apiKey
    ? {
        baseUrl: merged.cloudUrl.replace(/\/$/, ''),
        apiKey: merged.apiKey,
      }
    : null;

  return {
    local,
    cloud,
    hasApiKey: !!merged.apiKey,
  };
}

/**
 * Check if Ollama is running locally
 */
export async function isLocalRunning(client: { baseUrl: string }): Promise<boolean> {
  try {
    const res = await fetch(`${client.baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Get the appropriate client for a model
 * Cloud models have :cloud suffix
 */
export function getClientForModel(
  modelId: string,
  clients: OllamaClients,
  cloudOnly: boolean = false
): { client: { baseUrl: string; apiKey?: string }; isCloud: boolean } {
  const isCloudModel = modelId.includes(':cloud');

  if ((isCloudModel || cloudOnly) && clients.cloud) {
    return { client: clients.cloud, isCloud: true };
  }

  return { client: clients.local, isCloud: false };
}

/**
 * Get the actual model name without :cloud suffix
 */
export function getModelName(modelId: string): string {
  return modelId.replace(':cloud', '');
}

// ============================================================================
// MODEL DETAILS & CONTEXT LENGTH
// ============================================================================

/**
 * Get actual runtime context length from /api/ps
 * Returns the context length that's actually usable with current VRAM
 */
export async function getRuntimeContextLength(
  client: { baseUrl: string; apiKey?: string },
  modelName: string
): Promise<number | null> {
  try {
    const res = await fetch(`${client.baseUrl}/api/ps`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return null;

    const data = await res.json();
    const models = data.models || [];

    for (const m of models) {
      if (m.name === modelName || m.model === modelName) {
        if (m.context_length && typeof m.context_length === 'number') {
          return m.context_length;
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Get GPU memory info from nvidia-smi
 * Returns free VRAM in MB for each GPU
 */
export async function getGPUFreeMemory(): Promise<number[]> {
  try {
    const { spawnSync } = await import('child_process');
    const result = spawnSync('nvidia-smi', [
      '--query-gpu=memory.free',
      '--format=csv,noheader,nounits',
    ], { encoding: 'utf8' });

    if (result.status !== 0) return [];

    return result.stdout
      .trim()
      .split('\n')
      .map((line) => parseInt(line.trim(), 10))
      .filter((n) => !isNaN(n));
  } catch {
    return [];
  }
}

/**
 * Estimate optimal context length based on available GPU memory
 * Uses a heuristic: ~256 tokens/MB for quantized models
 * 
 * This estimates CONTEXT memory (KV cache), not model weights.
 */
export function estimateContextFromGPU(gpuFreeMB: number[]): number {
  const totalFreeMB = gpuFreeMB.reduce((a, b) => a + b, 0);

  // conservative: use 85% of free VRAM for context
  const allocatableMB = totalFreeMB * 0.85;

  // Use ~256 tokens per MB (conservative for modern quantized models)
  // 1 MB = 1024 KB, so ~0.25 tokens/KB or ~256 tokens/MB
  const tokens = Math.floor(allocatableMB * 256);

  // Round down to nearest 1024 for compatibility
  return Math.floor(tokens / 1024) * 1024;
}

/**
 * Extract context length from model info
 * Optionally accepts model name for fallback detection
 */
export function getContextLength(modelInfo: Record<string, any> | undefined, modelName?: string): number {
  // Try to get from model_info first
  if (modelInfo) {
    const keys = Object.keys(modelInfo);
    for (const key of keys) {
      if (key.endsWith('.context_length') && typeof modelInfo[key] === 'number') {
        return modelInfo[key];
      }
    }
    // Fallback: Check for any context_length key (Qwen3 uses modelprefix.context_length)
    for (const key of keys) {
      if (key.includes('context_length') && typeof modelInfo[key] === 'number') {
        return modelInfo[key];
      }
    }
  }

  // Fallback: detect from model name
  if (modelName) {
    const lower = modelName.toLowerCase();
    // Qwen3 models typically have 128k-256k context
    if (lower.includes('qwen3') || lower.includes('qwen3next')) return 262144;
    // Kimi models typically have 256k context
    if (lower.includes('kimi')) return 256000;
    // Minimax models
    if (lower.includes('minimax')) return 256000;
    // Qwen2.5 typically has 128k context
    if (lower.includes('qwen2.5')) return 128000;
  }

  return 128000;
}

/**
 * Get context length considering GPU memory constraints
 * Priority: runtime context > GPU estimate > metadata > default
 */
export async function getContextLengthWithGPUHealth(
  client: { baseUrl: string; apiKey?: string },
  modelName: string,
  modelInfo?: Record<string, any>
): Promise<number> {
  // 1. Try runtime context from /api/ps (most accurate for current state)
  const runtimeContext = await getRuntimeContextLength(client, modelName);
  if (runtimeContext) return runtimeContext;

  // 2. Try metadata context length
  if (modelInfo) {
    const metaContext = getContextLength(modelInfo, modelName);
    if (metaContext) return metaContext;
  }

  // 3. Fallback to GPU memory estimation
  const gpuFree = await getGPUFreeMemory();
  if (gpuFree.length > 0) {
    return estimateContextFromGPU(gpuFree);
  }

  // 4. Last resort default
  return 128000;
}

export interface ModelDetails {
  name: string;
  capabilities?: string[];
  model_info?: Record<string, any>;
  details?: {
    parameter_size?: string;
    family?: string;
    quantization_level?: string;
  };
  context_length?: number;
}

/**
 * Fetch detailed model info from Ollama's /api/show
 * Note: This is Ollama-specific, not OpenAI-compatible
 */
export async function fetchModelDetails(
  client: { baseUrl: string; apiKey?: string },
  modelName: string
): Promise<ModelDetails | null> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (client.apiKey) {
      headers['Authorization'] = `Bearer ${client.apiKey}`;
    }

    const res = await fetch(`${client.baseUrl}/api/show`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: modelName }),
    });

    if (!res.ok) return null;
    const data = await res.json();

    // Try to get runtime context from /api/ps for accuracy
    const runtimeContext = await getRuntimeContextLength(client, modelName);
    if (runtimeContext) {
      data.context_length = runtimeContext;
    }

    // Special case: Use our context-optimized models for qwen3-coder-next
    if (modelName === 'qwen3-coder-next:latest' || modelName === 'qwen3-coder-next') {
      // Priority: 200K > 128K > 64K > original
      const ctx200 = await getRuntimeContextLength(client, 'qwen3-coder-next-200k:latest');
      if (ctx200) {
        data.context_length = ctx200;
      } else {
        const ctx128 = await getRuntimeContextLength(client, 'qwen3-coder-next-128k:latest');
        if (ctx128) {
          data.context_length = ctx128;
        } else {
          const ctx64 = await getRuntimeContextLength(client, 'qwen3-coder-next-64k:latest');
          if (ctx64) {
            data.context_length = ctx64;
          } else if (data.context_length === 40960) {
            data.context_length = 65536; // fallback
          }
        }
      }
    }

    return data;
  } catch {
    return null;
  }
}

// ============================================================================
// MODEL METADATA PARSING
// ============================================================================

export function hasVisionCapability(details: ModelDetails): boolean {
  // Check capabilities array
  if (details.capabilities?.includes('vision')) return true;
  if (details.capabilities?.includes('image')) return true;

  // Check model_info for vision indicators
  if (details.model_info) {
    // CLIP vision encoder indicates vision capability
    if (details.model_info['clip.has_vision_encoder'] === true) return true;
    // Vision-specific architectures
    const arch = details.model_info['general.architecture'];
    if (arch && ['llava', 'bakllava', 'minicpmv', 'idefics'].includes(arch)) return true;
  }

  // Fallback case-insensitive name matching for vision models
  if (details.name) {
    const lower = details.name.toLowerCase();
    if (lower.includes('llava') || lower.includes('vision')) return true;
  }

  return false;
}

export function hasReasoningCapability(name: string, details?: ModelDetails): boolean {
  // Check details first if provided
  if (details?.capabilities?.includes('reasoning')) return true;

  // List of known reasoning models (case-insensitive)
  const reasoningModels = [
    'deepseek-r1',
    'deepseek-r1.5',
    'deepseek-r1.0',
    'kimi-k2.5',
    'kimi-k2',
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'llama-3.3-70b-instruct',
    'llama-3.3-70b-reasoning',
    'llama-3.3-70b-thinking',
    'qwen-3-235b-a3b-instruct',
    'qwen-3-235b-a3b-thinking',
    'qwen-3-235b',
    'qwen-3-32b',
    'qwen-3-8b',
    'qwen-3.2-3b',
    'qwen-3.2-1b',
    'qwen-3.0-32b',
    'qwen-3.0-8b',
    'qwen-3.0-1b',
    'qwen-2.5-32b',
    'qwen-2.5-14b',
    'qwen-2.5-7b',
    'qwen-2.5-3b',
    'qwen-2.5-1.5b',
    'qwen-2.5-1b',
    'qwen-2.5-math',
    'qwen-2.5-coder',
  ];

  const lower = name.toLowerCase();
  return reasoningModels.some((rm) => lower.includes(rm));
}

// ============================================================================
// LISTING MODELS
// ============================================================================

export interface ListedModel {
  name: string;
  isCloud: boolean;
  details?: ModelDetails;
}

/**
 * List all available models from both local and cloud
 * @param clients OllamaClients instance
 * @returns Array of model info objects
 */
export async function listAllModels(clients: OllamaClients): Promise<ListedModel[]> {
  const models: ListedModel[] = [];

  // 1. List local models (OpenAI-compatible /v1/models)
  try {
    const localRes = await fetch(`${clients.local.baseUrl}/v1/models`, {
      signal: AbortSignal.timeout(5000),
    });

    if (localRes.ok) {
      const localData = await localRes.json();
      const localModels = localData.data || [];
      for (const m of localModels) {
        const name = m.id || m.name || '';
        if (name) {
          const modelInfo = m.object === 'model' ? (m as any).owned_by : undefined;
          models.push({
            name,
            isCloud: false,
            details: {
              name,
              model_info: modelInfo,
              context_length: (m as any).context_length,
            },
          });
        }
      }
    }
  } catch (err) {
    debug('Error listing local models:', err);
  }

  // 2. List cloud models (using /v1/models with cloud config)
  if (clients.hasApiKey && clients.cloud) {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (clients.cloud.apiKey) {
        headers['Authorization'] = `Bearer ${clients.cloud.apiKey}`;
      }

      const cloudRes = await fetch(`${clients.cloud.baseUrl}/v1/models`, {
        headers,
        signal: AbortSignal.timeout(5000),
      });

      if (cloudRes.ok) {
        const cloudData = await cloudRes.json();
        const cloudModels = cloudData.data || [];
        for (const m of cloudModels) {
          const name = m.id || m.name || '';
          if (name) {
            models.push({
              name: `${name}:cloud`,
              isCloud: true,
              details: {
                name: name,
                model_info: (m as any).owned_by,
                context_length: (m as any).context_length,
              },
            });
          }
        }
      }
    } catch {
      // Cloud API not available
    }
  }

  return models;
}

// ============================================================================
// CHAT COMPLETION
// ============================================================================

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
}

export interface ChatOptions {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface ChatUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
}

export interface ChatResult {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string };
    finish_reason: string | null;
  }>;
  usage?: ChatUsage;
}

/**
 * Non-streaming chat completion using OpenAI-compatible endpoint
 */
export async function chat(
  client: { baseUrl: string; apiKey?: string },
  options: ChatOptions
): Promise<ChatResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (client.apiKey) {
    headers['Authorization'] = `Bearer ${client.apiKey}`;
  }

  const res = await fetch(`${client.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 4096,
      stream: false,
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`Chat completion failed: ${res.statusText} - ${err}`);
  }

  return await res.json();
}

/**
 * Streaming chat completion using OpenAI-compatible endpoint
 */
export async function* chatStream(
  client: { baseUrl: string; apiKey?: string },
  options: ChatOptions
): AsyncGenerator<{ type: 'chunk' | 'usage' | 'done'; content?: string; usage?: ChatUsage }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (client.apiKey) {
    headers['Authorization'] = `Bearer ${client.apiKey}`;
  }

  const res = await fetch(`${client.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 4096,
      stream: true,
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`Chat completion failed: ${res.statusText} - ${err}`);
  }

  if (!res.body) {
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value);
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;

      const data = trimmed.replace('data:', '').trim();
      if (data === '[DONE]') {
        yield { type: 'done' };
        return;
      }

      try {
        const json = JSON.parse(data);
        if (json.choices && json.choices.length > 0) {
          const delta = json.choices[0].delta;
          if (delta.content) {
            yield { type: 'chunk', content: delta.content };
          }
        } else if (json.usage) {
          yield { type: 'usage', usage: json.usage };
        }
      } catch {
        // Skip non-JSON lines
      }
    }
  }
}
