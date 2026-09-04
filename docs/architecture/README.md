# Architecture diagrams

Clean Excalidraw architecture views for Urban Planning Copilot, generated with the [excalidraw-skill](https://github.com/Agents365-ai/excalidraw-skill) conventions (`roughness: 0`, Helvetica, semantic palette — not hand-drawn).

| Diagram | Files | Description |
|---------|-------|-------------|
| System context | `01-system-context.*` | Actors, monolith boundary, external deps |
| Layered architecture | `02-layered-architecture.*` | Presentation → API → domain → integration → storage |
| Planning journey | `03-planning-journey.*` | Objective → PATCH → services → analysis → snapshot |
| Dual client | `04-dual-client.*` | Human UI vs WebMCP converging on one store |
| Deployment | `05-deployment.*` | Render build/seed/start + Postgres/disk |

## Regenerate

```bash
cd docs/architecture
npm install
npx playwright install firefox
python3 generate-diagrams.py
```

Outputs: editable `.excalidraw` sources plus exported `.png` and `.svg`.

Open any `.excalidraw` file at [excalidraw.com](https://excalidraw.com) to edit.
