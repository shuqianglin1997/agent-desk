'use strict';

// The environment variables Claude Code reads before its per-profile files.
// Claude Code launches set CLAUDE_CONFIG_DIR after clearing them; a Claude
// desktop launch clears them so it does not inherit a shell-level CLI proxy
// or config root.

const CLAUDE_CODE_ENV_KEYS = Object.freeze([
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_OAUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_API_BASE_URL',
  'ANTHROPIC_CONFIG_DIR',
  'ANTHROPIC_CUSTOM_HEADERS',
  'ANTHROPIC_UNIX_SOCKET',
  'ANTHROPIC_AWS_REGION',
  'ANTHROPIC_AWS_ACCESS_KEY_ID',
  'ANTHROPIC_AWS_SECRET_ACCESS_KEY',
  'ANTHROPIC_AWS_SESSION_TOKEN',
  'ANTHROPIC_BEDROCK_REGION',
  'ANTHROPIC_FOUNDRY_REGION',
  'ANTHROPIC_FOUNDRY_RESOURCE',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'CLAUDE_CONFIG_DIR',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_API_BASE_URL',
  'CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_PLUGIN_ROOT'
]);

function withoutClaudeCodeEnvironment(baseEnv = {}) {
  const env = { ...baseEnv };
  for (const key of Object.keys(env)) {
    const canonicalKey = key.toUpperCase();
    if (
      CLAUDE_CODE_ENV_KEYS.includes(canonicalKey) ||
      /^ANTHROPIC_(?:DEFAULT_|MODEL|SMALL_FAST_MODEL|CUSTOM_HEADERS|API_BASE_URL|BASE_URL|CONFIG_DIR|OAUTH_TOKEN|AUTH_TOKEN|API_KEY|AWS_|BEDROCK_|FOUNDRY_|VERTEX_|UNIX_SOCKET)/.test(canonicalKey) ||
      /^CLAUDE_CODE_(?:OAUTH_TOKEN|API_BASE_URL|API_KEY_|USE_(?:BEDROCK|FOUNDRY|VERTEX)|PLUGIN_)/.test(canonicalKey)
    ) delete env[key];
  }
  return env;
}

module.exports = { CLAUDE_CODE_ENV_KEYS, withoutClaudeCodeEnvironment };
