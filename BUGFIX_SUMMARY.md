# Bugfix Summary: Reasoning Detection Error

## Problem
Error: `400: does not support thinking` when using `qwen3-coder-next:latest`

## Root Cause
The heuristic `['coder', 'code', 'r1', ...]` was too broad → models like `qwen3-coder-next` falsely matched because they contain "coder" in the name, even though Ollama reports `capabilities: ["completion", "tools"]` (no `thinking`).

## Fix Applied
1. **Prioritize capabilities array**: First checks `details.capabilities?.includes('thinking')` (Ollama's authoritative answer)
2. **Tighter fallback heuristic**: Changed from `['coder', 'code', 'r1', ...]` to `['r1', 'deepseek', 'kimi', 'think', 'reason']` (removed `coder`/`code`)

## Files Changed
- `src/shared.ts`: Updated `hasReasoningCapability()`
- `src/index.ts`: Pass `details` to the function + add debug logging
- `test/shared.test.ts`: Added 4 regression tests
- `CHANGELOG.md`: Documented fix

## Verification
```bash
export PATH="$HOME/.bun/bin:$PATH" && bun test
# All 21 tests pass ✅
```

## How to Test
```bash
# With debug enabled:
export PI_OLLAMA_DEBUG=true
pi reload

# Check logs for:
# [pi-ollama] qwen3-coder-next: isVision=false, isReasoning=false
```

## Impact
- `qwen3-coder-next:latest` now works without error
- Other models with actual `thinking` capability continue to work
- No breaking changes
