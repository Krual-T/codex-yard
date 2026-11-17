// Model capabilities from DeepSeek's Codex integration, checked 2026-11-17:
// https://api-docs.deepseek.com/quick_start/agent_integrations/codex/
// Keep this catalog scoped to DeepSeek sessions; it must not replace the user's
// configured catalog for other providers.
export const deepseekModels = ['deepseek-flash', 'deepseek-v4-pro'].map((slug, index) => ({
  slug, display_name: index ? 'DeepSeek V4 Pro' : 'DeepSeek Flash',
  description: index ? 'DeepSeek coding and reasoning model' : 'DeepSeek model with image input',
  default_reasoning_level: 'high',
  supported_reasoning_levels: [
    { effort: 'low', description: '快速响应' },
    { effort: 'high', description: '深入推理' },
    { effort: 'max', description: '最高推理强度' },
  ],
  prefer_websockets: false, support_verbosity: true, default_verbosity: 'low',
  apply_patch_tool_type: 'freeform', web_search_tool_type: 'text',
  input_modalities: index ? ['text'] : ['text', 'image'], supports_image_detail_original: !index,
  truncation_policy: { mode: 'tokens', limit: 10_000 }, supports_parallel_tool_calls: true,
  tool_mode: null, multi_agent_version: 'v2', use_responses_lite: false,
  include_skills_usage_instructions: false, auto_review_model_override: null,
  include_plugin_usage_instructions: false, include_apps_usage_instructions: false,
  experimental_supported_tools: [], additional_speed_tiers: [], service_tiers: [], available_access_programs: { cyber: ['standard'] },
  supports_search_tool: false, supports_experimental_context: false,
  supports_reasoning_effort_updates: true, node_repl_auto_review_required: false, node_repl_disabled: false,
  context_window: 1_048_576, max_context_window: 1_048_576, effective_context_window_percent: 95,
  auto_compact_token_limit: null, comp_hash: '3000', reasoning_summary_format: 'experimental',
  default_reasoning_summary: 'none', shell_type: 'shell_command', visibility: 'list',
  minimal_client_version: '0.164.0', supported_in_api: true,
  availability_nux: null, upgrade: null, priority: index + 1,
  model_messages: { instructions_template: 'You are a coding assistant working with the user in a shared workspace. Inspect the project instructions, use the available tools to complete the requested work, verify the result, and communicate clearly. Preserve unrelated changes and protect credentials.', instructions_variables: {} },
}));

export const deepseekCatalog = JSON.stringify({ models: deepseekModels });
export function isDeepseekProvider(definition: Record<string, unknown>): boolean {
  if (typeof definition.base_url !== 'string') return false;
  try { return new URL(definition.base_url).hostname === 'api.deepseek.com'; } catch { return false; }
}
