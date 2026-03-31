# Pi-Ollama Codebase Analysis Report

**Generated:** 2026-03-31  
**Project:** @0xkobold/pi-ollama v0.2.0  
**Language:** TypeScript (ES2022)

---

## 1. Project Overview

**Purpose:** Ollama integration extension for pi-coding-agent providing unified local + cloud Ollama support with model management capabilities.

**Key Features:**
- Local Ollama connection (localhost:11434)
- Ollama Cloud with API key support
- Accurate model details via `/api/show` endpoint
- Vision capability detection
- Reasoning model detection
- OpenAI-compatible API endpoints (`/v1/*`)

---

## 2. Architecture

```
pi-ollama/
├── src/
│   ├── index.ts          # Extension entry point (168 lines)
│   └── shared.ts         # Shared utilities (420 lines)
├── test/
│   ├── shared.test.ts    # Unit tests for shared.ts
│   └── index.test.ts     # Unit tests for extension
├── dist/                 # Compiled output
├── package.json          # NPM package config
└── tsconfig.json         # TypeScript config
```

---

## 3. Key Insight: Why Extension is Required

| Feature | models.json alone | With pi-ollama extension |
|---------|-------------------|--------------------------|
| `/v1` endpoint | Manual config required | Auto-added |
| Vision detection | Defaults to text-only | Auto-detected via `/api/show` |
| Context length | Default 128k | Accurate from model info |
| Model discovery | Manual | Auto via `/api/tags` |

**Bottom line:** The extension is essential for proper Ollama integration.