# Investigation: Why Ollama Local Models Need pi-ollama Extension

## The Problem

Without the pi-ollama extension, Ollama local models **don't work** even though the baseUrl is correctly configured in `models.json`.

---

## Root Cause Analysis

### How pi-coding-agent Makes Requests

When pi-coding-agent makes an API request, it uses the `openai-completions` provider:

```javascript
function createClient(model, context, apiKey, optionsHeaders) {
    return new OpenAI({
        apiKey,
        baseURL: model.baseUrl,  // ← Uses model's baseUrl
    });
}
```

### What Happens for Ollama

**Without `/v1` in baseUrl:**
- Request to: `http://localhost:11434/chat/completions`
- Ollama returns: **404 Not Found**

**With `/v1` in baseUrl:**
- Request to: `http://localhost:11434/v1/chat/completions`
- Ollama returns: **200 OK**

### Vision Issue (Even with /v1)

**Silent image filtering:**
```javascript
const filteredContent = !model.input.includes(\"image\")
    ? content.filter((c) => c.type !== \"image_url\")  // ← IMAGES REMOVED!
    : content;
```

In `models.json`:
```javascript
input: (modelDef.input ?? [\"text\"]),  // Defaults to TEXT ONLY!
```

**Extension fixes both:**
1. Adds `/v1` to baseUrl
2. Queries `/api/show` to detect vision capability
3. Sets `input: ['text', 'image']` for vision models