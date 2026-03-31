# Changelog

All notable changes to this project will be documented in this file.

## [0.2.1] - 2026-03-31

### Fixed

- **Reasoning Detection Bug**: Fixes crash when models with "coder" in name (like `qwen3-coder-next`) were incorrectly detected as reasoning models, causing Ollama API error "does not support thinking"

### Changed

- `hasReasoningCapability()`: Now prioritizes `capabilities` array from `/api/show` (checks for `"thinking"`) over name heuristic
- Removed `'coder'` and `'code'` from the name heuristic fallback to prevent false positives
- The name heuristic now only matches: `r1`, `deepseek`, `kimi`, `think`, `reason`

### Added

- **Debug Logging**: Added optional debug mode via `PI_OLLAMA_DEBUG=true` that logs reasoning/vision detection for each model
- **Unit Tests**: 4 new tests covering reasoning detection edge cases
- **Logging Helper**: Exported `debug()` function for internal use

### Technical Details

**Before**: Models like `qwen3-coder-next` contained "coder" and were flagged as reasoning → caused `400: does not support thinking` error

**After**: 
- First checks actual `capabilities: ["thinking"]` from Ollama API (authoritative)
- Falls back to name heuristic only if no capabilities info
- `qwen3-coder-next` now correctly detected as `reasoning: false` (no thinking capability)

### How to Enable Debug Logging

```bash
# Set environment variable
export PI_OLLAMA_DEBUG=true

# In your pi session, the extension will now log:
# [pi-ollama] qwen3-coder-next: isVision=false, isReasoning=false
# [pi-ollama] qwen3.5:35b-a3b-q4_K_M: has thinking capability ✅
```
