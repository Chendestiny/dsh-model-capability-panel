#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""publish_local.py — 把 D:\\Project\\dsh-model-capability-panel 作为 link 安装进 dsh。

本脚本让 D:\\Project 下的源码目录成为 dsh 的插件源：用 `dsh plugin ... add <目录>`
把 profile 的依赖写成 `link:<目录>`，此后改代码 = 改本地安装（bundle 内容热重载）。

用法：
    python scripts/publish_local.py                 # 默认 profile=web
    python scripts/publish_local.py --profile web
    python scripts/publish_local.py --dry-run       # 只打印计划
    python scripts/publish_local.py --no-remove     # 不先卸载（首次安装用）

注意：客户端插件集合只在 dsh web **启动时**装配，装完/换 link 后需要重启 dsh web 才生效。
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

# Windows 控制台默认 GBK，直接 print "✓" 会抛 UnicodeEncodeError —— 强制 UTF-8 输出。
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

PKG_NAME = "dsh-model-capability-panel"
REPO_DIR = Path(__file__).resolve().parent.parent


def resolve_dsh() -> list[str]:
    """解析 dsh 启动器。

    Windows 上 `dsh` 是 nodejs 目录下的 .cmd/.ps1 垫片，CreateProcess 不会按
    PATHEXT 搜索裸名，直接 subprocess(["dsh", ...]) 会 WinError 2 ——
    所以这里显式解析带扩展名的可执行入口。
    """
    for cand in ("dsh.cmd", "dsh.exe", "dsh.bat"):
        found = shutil.which(cand)
        if found:
            return [found]
    found = shutil.which("dsh")
    if found:
        return [found]
    return ["cmd", "/c", "dsh"]


def run(cmd: list[str], dry: bool, check: bool = True) -> tuple[int, str]:
    if dry:
        print(f"  [dry-run] {' '.join(cmd)}")
        return 0, ""
    proc = subprocess.run(
        cmd,
        cwd=str(REPO_DIR),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    out = (proc.stdout or "").strip()
    if out:
        print("  " + out.replace("\n", "\n  ")[:1500])
    if check and proc.returncode != 0:
        print(f"  ✗ 命令失败（{proc.returncode}）：{' '.join(cmd)}")
    return proc.returncode, out


def main() -> int:
    ap = argparse.ArgumentParser(description="把本插件源码目录作为 link 安装进 dsh")
    ap.add_argument("--profile", default="web", help="dsh profile（默认 web）")
    ap.add_argument("--dry-run", action="store_true", help="只打印计划")
    ap.add_argument("--no-remove", action="store_true", help="跳过卸载步骤（首次安装）")
    args = ap.parse_args()

    dry = args.dry_run
    print(f"源目录：{REPO_DIR}")

    # 1) 源目录自检 —— 注册表/安装都要求 package.json 里声明 dsh.bundle
    pkg_path = REPO_DIR / "package.json"
    if not pkg_path.is_file():
        print("✗ 缺 package.json，这里不是插件仓库根")
        return 2
    pkg = json.loads(pkg_path.read_text(encoding="utf-8"))
    bundle = (pkg.get("dsh") or {}).get("bundle")
    if not bundle:
        print("✗ package.json 未声明 dsh.bundle —— 无法安装（dsh.client 单独声明不算可安装）")
        return 2
    patch = REPO_DIR / str(bundle.get("patch", "")).lstrip("./")
    if not patch.is_file():
        print(f"✗ cordis.patch.yml 不存在：{patch}")
        return 2
    client = (pkg.get("dsh") or {}).get("client")
    print(f"  package.json：{pkg['name']} v{pkg.get('version')} ✓ dsh.bundle ✓"
          + (" dsh.client ✓" if client else "（无客户端 bundle）"))
    if pkg.get("private") is True:
        print("  ⚠ private: true —— 本地 link 安装不受影响，但发不到 npm")

    # 2) 卸载旧安装（换 link 指向时必须先删，否则旧路径残留）
    dsh = resolve_dsh()
    print(f"  dsh 启动器：{' '.join(dsh)}")
    if not args.no_remove:
        print("\n[1/3] 卸载现有安装")
        run([*dsh, "plugin", "--profile", args.profile, "remove", PKG_NAME], dry, check=False)
    else:
        print("\n[1/3] 跳过卸载（--no-remove）")

    # 3) 安装本目录为 link
    print("\n[2/3] 安装本目录为 link")
    rc, _ = run([*dsh, "plugin", "--profile", args.profile, "add", str(REPO_DIR)], dry)
    if not dry and rc != 0:
        print("✗ 安装失败")
        return 1

    # 4) 验证 profile 里确实写成了 link:<本目录>
    print("\n[3/3] 验证 profile 依赖")
    profile_pkg = Path.home() / ".dsh" / "profiles" / args.profile / "package.json"
    if dry:
        print(f"  [dry-run] 检查 {profile_pkg} 中 {PKG_NAME} 是否为 link:{REPO_DIR}")
        return 0
    try:
        data = json.loads(profile_pkg.read_text(encoding="utf-8"))
        dep = (data.get("dependencies") or {}).get(PKG_NAME, "")
        bundles = ((data.get("dsh") or {}).get("profile") or {}).get("bundles") or []
        ok = str(dep).lower().startswith("link:") and PKG_NAME in bundles
        print(f"  dependencies: {dep}")
        print(f"  bundles 含本插件: {PKG_NAME in bundles}")
        print("✓ 安装完成" if ok else "⚠ 依赖/装配项不符合预期，请检查上面的输出")
    except Exception as exc:  # noqa: BLE001
        print(f"  ⚠ 读取 profile package.json 失败：{exc}")

    print(
        "\n提醒：客户端插件集合只在启动时装配 —— 请重启 dsh web 并刷新页面，"
        "设置里才会出现「模型能力」页。"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
