#!/usr/bin/env python3
"""DSH 沙箱安全的 ppt-master 导出 shim。

上游 svg_to_pptx.py 用 `Path.mkdir(mode=0o700)` 建临时工作目录；在 DSH 沙箱下
该目录创建后不可再写入 `.write-probe`，导出会报 PermissionError。这里在调用
官方 main() 前替换 builder._create_writable_work_dir 为不带 mode 的版本，
其余导出逻辑（attribution guard、质检、Native DrawingML）保持上游不变。

用法（由 deck_export 工具调用）：
  PPT_MASTER_DIR=<.../skills/ppt-master> python export_shim.py <project> --quick-generate --no-notes [-o OUTPUT]
"""
import os
import shutil
import sys
import tempfile
import uuid
from pathlib import Path

master = os.environ.get("PPT_MASTER_DIR", "").strip()
if master == "":
    sys.exit("PPT_MASTER_DIR is required")
scripts_dir = os.path.join(master, "scripts")
if not os.path.isdir(scripts_dir):
    sys.exit("PPT_MASTER_DIR does not contain scripts/: " + master)
sys.path.insert(0, scripts_dir)

from attribution_guard import require_skill_integrity  # noqa: E402
from console_encoding import configure_utf8_stdio  # noqa: E402
from svg_to_pptx import main  # noqa: E402
from svg_to_pptx.pptx_package import builder as builder_module  # noqa: E402


def _safe_work_dir(output_path):
    """与上游同语义，只是 mkdir 不带 0o700。"""
    parents = [Path(output_path).parent, Path.cwd(), Path(tempfile.gettempdir())]
    seen = set()
    for parent in parents:
        parent = parent if str(parent) else Path(".")
        try:
            parent.mkdir(parents=True, exist_ok=True)
        except OSError:
            continue
        key = str(parent.resolve())
        if key in seen:
            continue
        seen.add(key)
        for _ in range(3):
            work_dir = parent / f".pptx-build-{os.getpid()}-{uuid.uuid4().hex}"
            try:
                work_dir.mkdir()
                probe = work_dir / ".write-probe"
                probe.write_text("ok", encoding="utf-8")
                probe.unlink()
                return work_dir
            except OSError:
                shutil.rmtree(work_dir, ignore_errors=True)
    raise PermissionError("Unable to create a writable PPTX work directory")


builder_module._create_writable_work_dir = _safe_work_dir

configure_utf8_stdio()
require_skill_integrity()
sys.argv = ["svg_to_pptx.py"] + sys.argv[1:]
raise SystemExit(main())
