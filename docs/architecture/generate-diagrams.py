#!/usr/bin/env python3
"""Generate clean Excalidraw architecture diagrams for Urban Planning Copilot."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

OUT = Path(__file__).parent
ROUGHNESS = 0
FONT = 2


def scene(title: str, elements: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "type": "excalidraw",
        "version": 2,
        "source": "urban-planning-copilot",
        "elements": elements,
        "appState": {"viewBackgroundColor": "#ffffff"},
    }


def text(
    id_: str,
    x: float,
    y: float,
    label: str,
    *,
    size: int = 20,
    color: str = "#334155",
    width: float | None = None,
    align: str = "left",
    container: str | None = None,
    seed: int = 1,
) -> dict[str, Any]:
    w = width or max(80, len(label) * (9 if size >= 16 else 7))
    el: dict[str, Any] = {
        "id": id_,
        "type": "text",
        "x": x,
        "y": y,
        "width": w,
        "height": size + 6,
        "angle": 0,
        "strokeColor": color,
        "backgroundColor": "transparent",
        "fillStyle": "solid",
        "strokeWidth": 1,
        "roughness": ROUGHNESS,
        "opacity": 100,
        "seed": seed,
        "updated": 1,
        "text": label,
        "fontSize": size,
        "fontFamily": FONT,
        "textAlign": align,
        "verticalAlign": "middle" if container else "top",
        "boundElements": None,
    }
    if container:
        el["containerId"] = container
    return el


def box(
    id_: str,
    x: float,
    y: float,
    w: float,
    h: float,
    label: str,
    *,
    fill: str = "#e0f2fe",
    stroke: str = "#0369a1",
    seed: int = 1,
    roundness: int | None = None,
    bound: list[dict[str, str]] | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    label_id = f"{id_}_lbl"
    bounds = bound or []
    bounds.append({"id": label_id, "type": "text"})
    rect: dict[str, Any] = {
        "id": id_,
        "type": "rectangle",
        "x": x,
        "y": y,
        "width": w,
        "height": h,
        "angle": 0,
        "strokeColor": stroke,
        "backgroundColor": fill,
        "fillStyle": "solid",
        "strokeWidth": 2,
        "roughness": ROUGHNESS,
        "opacity": 100,
        "seed": seed,
        "updated": 1,
        "boundElements": bounds,
    }
    if roundness:
        rect["roundness"] = {"type": roundness}
    lbl = text(
        label_id,
        x,
        y + (h - 24) / 2,
        label,
        size=18 if len(label) > 18 else 20,
        color="#1e293b",
        width=w,
        align="center",
        container=id_,
        seed=seed + 1,
    )
    return rect, lbl


def zone(
    id_: str,
    x: float,
    y: float,
    w: float,
    h: float,
    *,
    seed: int = 1,
) -> dict[str, Any]:
    return {
        "id": id_,
        "type": "rectangle",
        "x": x,
        "y": y,
        "width": w,
        "height": h,
        "angle": 0,
        "strokeColor": "#475569",
        "backgroundColor": "#f1f5f9",
        "fillStyle": "solid",
        "strokeWidth": 2,
        "strokeStyle": "dashed",
        "roughness": ROUGHNESS,
        "opacity": 30,
        "seed": seed,
        "updated": 1,
        "boundElements": None,
    }


def arrow(
    id_: str,
    x: float,
    y: float,
    points: list[list[float]],
    *,
    dashed: bool = False,
    seed: int = 1,
) -> dict[str, Any]:
    return {
        "id": id_,
        "type": "arrow",
        "x": x,
        "y": y,
        "width": abs(points[-1][0]),
        "height": abs(points[-1][1]) if len(points) == 2 else max(abs(p[1]) for p in points),
        "angle": 0,
        "strokeColor": "#475569",
        "backgroundColor": "transparent",
        "fillStyle": "solid",
        "strokeWidth": 2,
        "strokeStyle": "dashed" if dashed else "solid",
        "roughness": ROUGHNESS,
        "opacity": 100,
        "seed": seed,
        "updated": 1,
        "points": points,
        "startArrowhead": None,
        "endArrowhead": "arrow",
        "boundElements": None,
    }


def ellipse_db(id_: str, x: float, y: float, label: str, *, seed: int = 1) -> list[dict[str, Any]]:
    w, h = max(160, len(label) * 9 + 40), 70
    rect = {
        "id": id_,
        "type": "ellipse",
        "x": x,
        "y": y,
        "width": w,
        "height": h,
        "angle": 0,
        "strokeColor": "#6b21a8",
        "backgroundColor": "#f3e8ff",
        "fillStyle": "solid",
        "strokeWidth": 2,
        "roughness": ROUGHNESS,
        "opacity": 100,
        "seed": seed,
        "updated": 1,
        "boundElements": [{"id": f"{id_}_lbl", "type": "text"}],
    }
    lbl = text(
        f"{id_}_lbl",
        x,
        y + (h - 24) / 2,
        label,
        size=18,
        color="#1e293b",
        width=w,
        align="center",
        container=id_,
        seed=seed + 1,
    )
    return [rect, lbl]


def diagram_system_context() -> dict[str, Any]:
    els: list[dict[str, Any]] = []
    els.append(text("title", 40, 30, "Urban Planning Copilot — System Context", size=28, color="#1e293b", width=720, seed=100001))

    # Actors row
    for i, (id_, label) in enumerate(
        [("hp", "Human planner"), ("ai", "AI agents (WebMCP)"), ("ci", "CI / eval harness")]
    ):
        r, l = box(id_, 60 + i * 280, 110, 220, 64, label, fill="#dbeafe", stroke="#1e40af", seed=100010 + i * 10)
        els.extend([r, l])

    # System box
    z = zone("sys_zone", 40, 240, 920, 200, seed=100050)
    els.append(z)
    els.append(text("sys_hdr", 60, 252, "Urban Planning Copilot (Next.js monolith)", size=24, color="#1e293b", width=500, seed=100051))
    r, l = box("upc", 320, 300, 360, 90, "UI + API + Domain + Analysis", fill="#e0f2fe", stroke="#0369a1", seed=100060)
    els.extend([r, l])

    # External row
    els.append(text("ext_hdr", 40, 500, "External dependencies", size=24, color="#1e293b", width=400, seed=100100))
    externals = [
        ("carto", "Carto basemap tiles"),
        ("sf", "SF Open Data snapshots"),
        ("neon", "Neon Postgres"),
        ("render", "Render (host + disk)"),
    ]
    for i, (id_, label) in enumerate(externals):
        items = ellipse_db(id_, 60 + i * 230, 560, label, seed=100110 + i * 10)
        els.extend(items)

    # Arrows actors -> system
    for i, x in enumerate([170, 450, 730]):
        els.append(arrow(f"a{i}", x, 174, [[0, 0], [0, 66]], seed=100200 + i))

    # Arrows system -> external
    els.append(arrow("d0", 500, 390, [[0, 0], [0, 170]], seed=100210))
    els.append(arrow("d1", 420, 390, [[0, 0], [-120, 170]], seed=100211))
    els.append(arrow("d2", 580, 390, [[0, 0], [120, 170]], seed=100212))
    els.append(arrow("d3", 650, 390, [[0, 0], [200, 170]], seed=100213))

    return scene("system-context", els)


def diagram_layered() -> dict[str, Any]:
    els: list[dict[str, Any]] = []
    els.append(text("title", 40, 24, "Layered Architecture", size=28, color="#1e293b", width=500, seed=200001))

    layers = [
        ("presentation", "Presentation", 90, "#dbeafe", "#1e40af", [
            "page.tsx — Home / New / Explore",
            "workspace-client.tsx — Planner shell",
            "PlanningMap · UrbanPlanningCopilot",
            "useWorkspace() hook",
        ]),
        ("api", "API boundary", 250, "#e0f2fe", "#0369a1", [
            "/api/projects · /api/mcp",
            "/api/datasets · /api/explore",
            "/api/health · /api/ping",
        ]),
        ("domain", "Domain core", 410, "#dcfce7", "#166534", [
            "services.ts — mutations & queries",
            "spatial.ts — Turf analysis engine",
            "objective.ts · compare · decision",
        ]),
        ("integration", "Agent integration", 570, "#fef9c3", "#854d0e", [
            "webmcp/server-handlers.ts",
            "register-browser.ts · tool-definitions",
            "workspace-sync.ts event bus",
        ]),
        ("storage", "Persistence", 730, "#f3e8ff", "#6b21a8", [
            "store.ts in-memory cache",
            "store-postgres.ts · store.json",
            "snapshots/sf/*.geojson.gz",
        ]),
    ]

    for id_, title, y, fill, stroke, lines in layers:
        z = zone(f"z_{id_}", 40, y - 10, 1040, 150, seed=200010)
        els.append(z)
        els.append(text(f"h_{id_}", 60, y, title, size=24, color="#1e293b", width=300, seed=200011))
        for j, line in enumerate(lines):
            col = j % 2
            row = j // 2
            r, l = box(
                f"b_{id_}_{j}",
                80 + col * 520,
                y + 42 + row * 56,
                min(500, max(220, len(line) * 9 + 40)),
                48,
                line,
                fill=fill,
                stroke=stroke,
                seed=200020 + j,
            )
            els.extend([r, l])

    # Down arrows between layers
    for i, y in enumerate([220, 390, 560, 730]):
        els.append(arrow(f"flow_{i}", 560, y, [[0, 0], [0, 40]], seed=200300 + i))

    return scene("layered", els)


def diagram_planning_journey() -> dict[str, Any]:
    els: list[dict[str, Any]] = []
    els.append(text("title", 40, 24, "Planning Journey — Data Flow", size=28, color="#1e293b", width=560, seed=300001))

    steps = [
        ("s1", "Set objective\nconstraints weights"),
        ("s2", "PATCH update_*"),
        ("s3", "services.ts\nupdateStore()"),
        ("s4", "run_analysis"),
        ("s5", "spatial.ts\nTurf ranking"),
        ("s6", "WorkspaceSnapshot\n→ UI + map"),
    ]
    x0, y = 60, 140
    bw, gap = 150, 50
    prev_right = None
    for i, (id_, label) in enumerate(steps):
        x = x0 + i * (bw + gap)
        fill = "#fed7aa" if i == 0 else "#e0f2fe" if i < 5 else "#dcfce7"
        stroke = "#c2410c" if i == 0 else "#0369a1" if i < 5 else "#166534"
        r, l = box(id_, x, y, bw, 72, label.replace("\n", " "), fill=fill, stroke=stroke, seed=300010 + i * 10)
        # fix multiline labels manually
        l["text"] = label
        l["height"] = 48
        els.extend([r, l])
        if prev_right is not None:
            els.append(arrow(f"ar_{i}", prev_right, y + 36, [[0, 0], [gap, 0]], seed=300100 + i))
        prev_right = x + bw

    els.append(text("note", 60, 280, "Single authority: every mutation converges on services.ts → updateStore()", size=16, color="#64748b", width=900, seed=300200))
    return scene("planning-journey", els)


def diagram_dual_client() -> dict[str, Any]:
    els: list[dict[str, Any]] = []
    els.append(text("title", 40, 24, "Dual Client — One Domain State", size=28, color="#1e293b", width=560, seed=400001))

    # Human path (top)
    els.append(text("h_hdr", 60, 90, "Human path", size=24, color="#1e293b", width=200, seed=400010))
    human = [
        ("ui", "UI controls", 80, 140),
        ("hook", "useWorkspace().act()", 300, 140),
        ("patch", "PATCH /api/projects", 560, 140),
    ]
    for id_, label, x, y in human:
        r, l = box(id_, x, y, 180, 56, label, fill="#dbeafe", stroke="#1e40af", seed=400020)
        els.extend([r, l])
    els.append(arrow("h1", 260, 168, [[0, 0], [40, 0]], seed=400030))
    els.append(arrow("h2", 480, 168, [[0, 0], [80, 0]], seed=400031))

    # Agent path (bottom)
    els.append(text("a_hdr", 60, 260, "Agent path (WebMCP)", size=24, color="#1e293b", width=300, seed=400040))
    agent = [
        ("tool", "WebMCP tool", 80, 310),
        ("reg", "register-browser.ts", 280, 310),
        ("mcp", "POST /api/mcp", 520, 310),
        ("opt", "Optimistic UI +\nevent bus", 740, 310),
    ]
    for id_, label, x, y in agent:
        r, l = box(id_, x, y, 170, 56, label.replace("\n", " "), fill="#f3e8ff", stroke="#6b21a8", seed=400050)
        l["text"] = label
        els.extend([r, l])
    els.append(arrow("a1", 250, 338, [[0, 0], [30, 0]], seed=400060))
    els.append(arrow("a2", 450, 338, [[0, 0], [70, 0]], seed=400061))
    els.append(arrow("a3", 690, 338, [[0, 0], [50, 0]], seed=400062))

    # Convergence
    r, l = box("svc", 360, 430, 280, 72, "services.*()  →  updateStore()", fill="#dcfce7", stroke="#166534", seed=400070)
    els.extend([r, l])
    els.append(arrow("c1", 650, 196, [[0, 0], [-90, 234]], seed=400080))
    els.append(arrow("c2", 605, 366, [[0, 0], [-135, 64]], seed=400081))
    els.append(arrow("c3", 855, 366, [[0, 0], [-215, 64]], seed=400082, dashed=True))

    r2, l2 = box("refresh", 360, 540, 280, 56, "notifyWorkspaceMutated → refresh()", fill="#e0f2fe", stroke="#0369a1", seed=400090)
    els.extend([r2, l2])
    els.append(arrow("c4", 500, 502, [[0, 0], [0, 38]], seed=400091))

    return scene("dual-client", els)


def diagram_deployment() -> dict[str, Any]:
    els: list[dict[str, Any]] = []
    els.append(text("title", 40, 24, "Deployment on Render", size=28, color="#1e293b", width=500, seed=500001))

    z = zone("render_z", 40, 80, 700, 420, seed=500010)
    els.append(z)
    els.append(text("rz_lbl", 60, 92, "Render Web Service (Node 22)", size=24, color="#1e293b", width=400, seed=500011))

    pipeline = ["npm ci && npm run build", "npm run seed", "npm start (next start)"]
    for i, step in enumerate(pipeline):
        r, l = box(f"p{i}", 80, 140 + i * 70, 620, 50, step, fill="#e0f2fe", stroke="#0369a1", seed=500020 + i)
        els.extend([r, l])
        if i < 2:
            els.append(arrow(f"pf{i}", 390, 190 + i * 70, [[0, 0], [0, 20]], seed=500030 + i))

    # Persistence side
    for i, (id_, label) in enumerate([("disk", "Persistent disk\n/var/data/store.json"), ("pg", "Neon Postgres\n(DATABASE_URL)")]):
        items = ellipse_db(id_, 780, 160 + i * 140, label, seed=500100 + i)
        for it in items:
            if it["type"] == "text":
                it["text"] = label
        els.extend(items)
        els.append(arrow(f"ps{i}", 700, 200 + i * 140, [[0, 0], [80, 0]], seed=500110 + i, dashed=(i == 1)))

    els.append(text("note", 60, 520, "UPC_ANALYSIS_SYNC=0 — analysis runs in-process via setImmediate (no separate worker)", size=16, color="#64748b", width=900, seed=500200))
    return scene("deployment", els)


DIAGRAMS = {
    "01-system-context": diagram_system_context,
    "02-layered-architecture": diagram_layered,
    "03-planning-journey": diagram_planning_journey,
    "04-dual-client": diagram_dual_client,
    "05-deployment": diagram_deployment,
}


def export_local(excalidraw_path: Path, out_path: Path, fmt: str) -> None:
    cli = Path(__file__).parent / "node_modules" / ".bin" / "excalidraw-brute-export-cli"
    if not cli.exists():
        raise SystemExit("Run: npm install excalidraw-brute-export-cli in docs/architecture/")
    subprocess.run(
        [
            str(cli),
            "-i",
            str(excalidraw_path),
            "-o",
            str(out_path),
            "-f",
            fmt,
            "-s",
            "2" if fmt == "png" else "1",
            "-b",
            "true",
        ],
        check=True,
    )


def main() -> None:
    for name, builder in DIAGRAMS.items():
        path = OUT / f"{name}.excalidraw"
        data = builder()
        path.write_text(json.dumps(data, indent=2))
        export_local(path, OUT / f"{name}.png", "png")
        export_local(path, OUT / f"{name}.svg", "svg")
        print(f"Wrote {name}.excalidraw + .png + .svg")


if __name__ == "__main__":
    main()
