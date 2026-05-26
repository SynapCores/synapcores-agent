#!/usr/bin/env python3
"""Record a real customer-support chat session in the browser widget.

Drives the live two-pane chat widget (``python -m synapcores_agent chat``) with
Playwright: types each customer line into the composer with human-like timing,
sends it, and WAITS for that turn's agent reply bubble AND the Brain sidebar to
finish updating before moving on (no racing). Then converts the recorded .webm
to docs/demo/support-chat.mp4 (+ .gif) with ffmpeg.

Every turn is a REAL agent turn against the running server (which itself runs
the real SynapCores brain loop). The scripted arc is the same 5-turn
conversation as examples/record_session.py, including the memory beat:

  T1  Annual plan + can't log in
  T2  reset email never arrived
  T3  refund on the annual subscription (topic shift → KB)
  T4  "remind me what we were troubleshooting"  → recalls the login issue
  T5  "which plan did I say I'm on?"             → recalls the Annual plan

Usage:
    python scripts/record_chat.py [--url http://127.0.0.1:8810/] [--out docs/demo]
"""

from __future__ import annotations

import argparse
import asyncio
import os
import subprocess
import sys
from pathlib import Path

from playwright.async_api import async_playwright

REPO = Path(__file__).resolve().parent.parent

CONVERSATION = [
    "Hi, I'm on the Annual plan and I can't log in — it keeps saying my password is wrong.",
    "I tried resetting it but the reset email never arrived.",
    "Separately — if I cancel, can I get a refund on my annual subscription?",
    "Sorry, remind me — what were we troubleshooting earlier with my account?",
    "Right, that one. And which plan did I say I'm on?",
]


async def play(url: str, out_dir: Path, screenshot: Path) -> Path:
    video_dir = out_dir / "_raw_video"
    video_dir.mkdir(parents=True, exist_ok=True)

    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--no-sandbox"])
        context = await browser.new_context(
            record_video_dir=str(video_dir),
            record_video_size={"width": 1440, "height": 900},
            viewport={"width": 1440, "height": 900},
            device_scale_factor=1,
        )
        page = await context.new_page()
        await page.goto(url, wait_until="networkidle")

        # Let the branded greeting + WS connect land.
        await page.wait_for_selector(".row.agent .bubble", timeout=15000)
        await page.wait_for_timeout(1200)

        composer = page.locator("#input")

        for i, line in enumerate(CONVERSATION, start=1):
            # Count agent bubbles BEFORE we send (greeting + prior replies).
            before = await page.locator(".row.agent:not([data-typing]) .bubble").count()

            await composer.click()
            # Human-ish per-char typing.
            await composer.type(line, delay=38)
            await page.wait_for_timeout(450)
            await page.keyboard.press("Enter")

            # The user bubble should appear immediately.
            await page.wait_for_timeout(300)

            # WAIT for a NEW agent reply bubble (count increases). gpt-4o + the
            # real brain loop can take a while — give it a generous window.
            try:
                await page.wait_for_function(
                    "(n) => document.querySelectorAll('.row.agent:not([data-typing]) .bubble').length > n",
                    arg=before,
                    timeout=120000,
                )
            except Exception:
                print(f"  ! turn {i}: timed out waiting for agent reply", file=sys.stderr)

            # WAIT for the Brain sidebar's "wrote turn to memory" line for THIS
            # turn — that is the last animated section, so the trace is complete.
            try:
                await page.wait_for_function(
                    "(n) => document.querySelectorAll('.turn-block .wrote-line').length >= n",
                    arg=i,
                    timeout=30000,
                )
            except Exception:
                print(f"  ! turn {i}: brain trace did not finish in time", file=sys.stderr)

            print(f"  turn {i} done: {line[:48]}…")
            # Human pause between turns so the recording reads naturally.
            await page.wait_for_timeout(2200)

        # Final beat — let the last reply + brain trace settle on screen.
        await page.wait_for_timeout(2500)

        # A high-res screenshot of the finished session.
        screenshot.parent.mkdir(parents=True, exist_ok=True)
        await page.screenshot(path=str(screenshot), full_page=False)
        print(f"  screenshot → {screenshot}")

        # Closing the context flushes the .webm to disk.
        await context.close()
        video_path = Path(await page.video.path())
        await browser.close()

    # Move the webm to a stable name.
    final_webm = out_dir / "support-chat.webm"
    if final_webm.exists():
        final_webm.unlink()
    video_path.replace(final_webm)
    return final_webm


def convert(webm: Path, out_dir: Path) -> None:
    mp4 = out_dir / "support-chat.mp4"
    gif = out_dir / "support-chat.gif"

    # MP4: H.264, yuv420p, faststart. Pad to even dims (libx264 requires it).
    subprocess.run(
        [
            "ffmpeg", "-y", "-i", str(webm),
            "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
            "-c:v", "libx264", "-pix_fmt", "yuv420p",
            "-movflags", "+faststart", "-preset", "medium", "-crf", "23",
            str(mp4),
        ],
        check=True,
    )
    print(f"  mp4 → {mp4}")

    # GIF: a clean palette at a sane width/fps.
    palette = out_dir / "_palette.png"
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(webm),
         "-vf", "fps=12,scale=900:-1:flags=lanczos,palettegen", str(palette)],
        check=True,
    )
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(webm), "-i", str(palette),
         "-lavfi", "fps=12,scale=900:-1:flags=lanczos[x];[x][1:v]paletteuse",
         str(gif)],
        check=True,
    )
    palette.unlink(missing_ok=True)
    print(f"  gif → {gif}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:8810/")
    ap.add_argument("--out", default=str(REPO / "docs" / "demo"))
    ap.add_argument(
        "--screenshot", default=str(REPO / "docs" / "demo" / "support-chat.png")
    )
    args = ap.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"recording {len(CONVERSATION)}-turn session from {args.url}")
    webm = asyncio.run(play(args.url, out_dir, Path(args.screenshot)))
    print(f"  webm → {webm}")

    convert(webm, out_dir)

    # tidy raw video dir
    raw = out_dir / "_raw_video"
    if raw.exists():
        for f in raw.iterdir():
            f.unlink()
        raw.rmdir()

    print("done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
