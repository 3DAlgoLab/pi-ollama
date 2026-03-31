# Ollama Modelfile Guide

## Quick Start

1. Create Modelfile:
```dockerfile
FROM llama3.2
SYSTEM \"You are Mario from Super Mario Bros\"
PARAMETER temperature 1
PARAMETER num_ctx 4096
```

2. Create model:
```bash
ollama create mario -f Modelfile
```

3. Run:
```bash
ollama run mario
```

## Key API

- `/api/create` - Create model from Modelfile
- `/api/show` - Show model info + Modelfile
- `/api/tags` - List models