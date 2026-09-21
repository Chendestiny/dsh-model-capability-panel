#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""publish_github.py — 把 D:\\Project\\dsh-model-modality-panel 提交并推送到 GitHub。

用法：
    python scripts/publish_github.py                          # 用默认提交信息
    python scripts/publish_github.py -m "feat: xxx"           # 自定义提交信息
    python scripts/publish_github.py --dry-run                # 只打印计划，不执行
    python scripts/publish_github.py --repo <url>             # 覆盖远程地址

本机事实（来自 github-publish 技能，已实测）：
  · GitHub 账号 Chendestiny；个人提交身份见 AUTHOR_NAME / AUTHOR_EMAIL
  · 直连 github.com:443 常超时，git 必须走系统代理；代理地址从注册表实时读，
    且只作为一次性环境变量使用，绝不写进 git 全局配置
  · push 即使输出 "Everything up-to-date" 或零输出也不代表成功，必须做 SHA 三方比对
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

# Windows 控制台默认 GBK，直接 print "✓" 会抛 UnicodeEncodeError —— 强制 UTF-8 输出。
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

AUTHOR_NAME = "Chendestiny"
AUTHOR_EMAIL = "42106833+Chendestiny@users.noreply.github.com"
DEFAULT_REPO = "https://github.com/Chendestiny/dsh-model-modality-panel.git"
DEFAULT_MESSAGE = "chore: sync local source"
REPO_DIR = Path(__file__).resolve().parent.parent


def run(cmd: list[str], dry: bool, env: dict | None = None, check: bool = True) -> tuple[int, str]:
    """执行一条命令，返回 (exit_code, 合并输出)。dry-run 时只打印。"""
    printable = " ".join(cmd)
    if dry:
        print(f"  [dry-run] {printable}")
        return 0, ""
    proc = subprocess.run(
        cmd,
        cwd=str(REPO_DIR),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    out = proc.stdout or ""
    if check and proc.returncode != 0:
        print(f"  ✗ 命令失败（{proc.returncode}）：{printable}")
        print("    " + out.strip().replace("\n", "\n    ")[:2000])
    return proc.returncode, out


def system_proxy() -> str | None:
    """从 HKCU Internet Settings 读系统代理（启用时返回 http://host:port）。"""
    try:
        import winreg
    except ImportError:
        return None
    try:
        key = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Internet Settings",
        )
        enabled, _ = winreg.QueryValueEx(key, "ProxyEnable")
        server, _ = winreg.QueryValueEx(key, "ProxyServer")
        winreg.CloseKey(key)
    except OSError:
        return None
    if not enabled or not server:
        return None
    server = str(server).strip()
    if "=" in server:  # 形如 "http=127.0.0.1:9674;https=..."
        parts = dict(
            p.split("=", 1) for p in server.split(";") if "=" in p
        )
        server = parts.get("https") or parts.get("http") or server
    if not server.startswith("http"):
        server = "http://" + server
    return server


def git(*args: str, dry: bool = False, env: dict | None = None, check: bool = True) -> tuple[int, str]:
    return run(["git", *args], dry, env=env, check=check)


def main() -> int:
    ap = argparse.ArgumentParser(description="提交并推送本插件源码到 GitHub")
    ap.add_argument("-m", "--message", default=DEFAULT_MESSAGE, help="提交信息")
    ap.add_argument("--repo", default=DEFAULT_REPO, help="远程仓库地址")
    ap.add_argument("--remote", default="origin", help="远程名（默认 origin）")
    ap.add_argument("--dry-run", action="store_true", help="只打印计划")
    args = ap.parse_args()

    dry = args.dry_run
    print(f"仓库目录：{REPO_DIR}")
    if not (REPO_DIR / "package.json").is_file():
        print("✗ 这里不是插件仓库根（缺 package.json）")
        return 2

    # 0) 拟提交内容概览
    print("\n[0/6] 待提交文件")
    _, status = git("status", "--porcelain", dry=dry)
    if not dry:
        if status.strip():
            print("  " + status.strip().replace("\n", "\n  ")[:1500])
        else:
            print("  （工作区干净，没有改动）")

    # 1) 确保是 git 仓库
    print("\n[1/6] 检查 git 仓库")
    if (REPO_DIR / ".git").is_dir():
        print("  已存在 .git")
    else:
        rc, _ = git("init", "-b", "main", check=False, dry=dry)
        if rc != 0:  # 老版本 git 不支持 -b
            git("init", dry=dry)
            git("branch", "-M", "main", dry=dry)
        print("  已 git init（main 分支）")

    # 2) 仓库级身份（绝不改全局）
    print("\n[2/6] 仓库级提交身份")
    git("config", "user.name", AUTHOR_NAME, dry=dry)
    git("config", "user.email", AUTHOR_EMAIL, dry=dry)
    print(f"  {AUTHOR_NAME} <{AUTHOR_EMAIL}>")

    # 3) 提交
    print("\n[3/6] git add + commit")
    git("add", "-A", dry=dry)
    rc, out = git("commit", "-m", args.message, check=False, dry=dry)
    if not dry and rc != 0:
        if "nothing to commit" in out.lower():
            print("  没有需要提交的改动，跳过提交")
        else:
            print("  ⚠ 提交返回非 0，请检查上面的输出")

    # 4) 远程
    print("\n[4/6] 远程仓库")
    rc, remotes = git("remote", dry=dry, check=False)
    if not dry and args.remote in remotes:
        print(f"  {args.remote} 已存在：{remotes.strip()}")
    else:
        git("remote", "add", args.remote, args.repo, dry=dry)
        print(f"  已添加 {args.remote} -> {args.repo}")

    # 5) push（直连失败则用注册表里的系统代理重试一次）
    print("\n[5/6] push")
    proxy = system_proxy()
    env_proxy = {**os.environ, "HTTPS_PROXY": proxy, "HTTP_PROXY": proxy} if proxy else None
    rc, out = git("push", "-u", args.remote, "main", check=False, dry=dry)
    if not dry and rc != 0 and env_proxy:
        print(f"  直连失败，改用系统代理 {proxy} 重试…")
        rc, out = git("push", "-u", args.remote, "main", check=False, env=env_proxy)
    if not dry and rc != 0:
        print("  ✗ push 失败。若为超时，确认加速器已开启；若为 403，需重新走一次 GCM 授权。")
        return 1
    if not dry and proxy is None:
        print("  （未检测到系统代理；直连若可行则无妨）")

    # 6) SHA 三方比对 —— 唯一可信的推送验证
    print("\n[6/6] SHA 三方比对")
    if dry:
        print("  [dry-run] git rev-parse HEAD / origin/main / ls-remote origin main")
        return 0
    git("fetch", args.remote, dry=dry, env=env_proxy, check=False)
    _, head = git("rev-parse", "HEAD", check=False)
    _, origin = git("rev-parse", f"{args.remote}/main", check=False)
    _, lsremote = git("ls-remote", args.remote, "main", check=False)
    head, origin = head.strip(), origin.strip()
    lsremote_sha = lsremote.strip().split()[0] if lsremote.strip() else "(空)"
    print(f"  HEAD          : {head[:12]}")
    print(f"  origin/main   : {origin[:12]}")
    print(f"  ls-remote     : {lsremote_sha[:12]}")

    _, authors = git("log", "--format=%an <%ae>", check=False)
    uniq = sorted({a.strip() for a in authors.splitlines() if a.strip()})
    print("  提交作者      : " + " | ".join(uniq))
    if any("@" in a and "Chendestiny" not in a for a in uniq):
        print("  ⚠ 检测到非 Chendestiny 身份的提交，公开前请先处理（公司身份不得进个人仓库）")

    if head and head == origin == lsremote_sha:
        print("\n✓ 推送成功并已验证（三个 SHA 一致）")
        return 0
    print("\n✗ 推送未确认：三个 SHA 不一致，检查上面的输出")
    return 1


if __name__ == "__main__":
    sys.exit(main())
