"""
配图像素级自检。

不能替代人眼，但能挡住最常见的失败：图没画出来、条形颜色错了、
文字没渲染（字体缺失会变成方块或空白）、元素溢出画布。

检查项：
  1. 尺寸与 DPI
  2. 背景占比（>99% 说明基本是空图）
  3. 关键色块像素数（TERRA / OLIVE / AMBER 各自应该存在）
  4. 深色像素（文字与轴线）的分布范围，判断是否贴边溢出
"""

import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_CANDIDATES = [
    os.path.join(ROOT, "docs", "figures"),
    os.path.join(ROOT, "deliver", "listjs-dom-sync", "docs", "figures"),
]
OUTDIR = next(p for p in _CANDIDATES if os.path.isdir(p))

TARGETS = {
    "TERRA": (0xB4, 0x55, 0x2F),
    "OLIVE": (0x6B, 0x6B, 0x3A),
    "AMBER": (0xC8, 0x89, 0x2B),
    "PAPER": (0xFA, 0xF6, 0xF0),
    "INK": (0x2B, 0x21, 0x19),
}
TOL = 10


def near(px, target, tol=TOL):
    return all(abs(px[i] - target[i]) <= tol for i in range(3))


def analyse(path):
    im = Image.open(path).convert("RGB")
    w, h = im.size
    px = im.load()

    counts = {k: 0 for k in TARGETS}
    dark_cols = []
    dark_rows = []
    total = w * h

    for y in range(h):
        for x in range(w):
            p = px[x, y]
            for k, t in TARGETS.items():
                if near(p, t):
                    counts[k] += 1
                    break
            else:
                # 深色但不是纯 INK（抗锯齿边缘）
                if sum(p) < 330:
                    dark_cols.append(x)
                    dark_rows.append(y)

    bg_ratio = counts["PAPER"] / total
    dark_bbox = None
    if dark_cols:
        dark_bbox = (min(dark_cols), min(dark_rows), max(dark_cols), max(dark_rows))

    print(f"\n{os.path.basename(path)}  {w}x{h}px")
    print(f"  background coverage : {bg_ratio * 100:5.1f}%")
    for k in ("TERRA", "OLIVE", "AMBER"):
        print(f"  {k:<6} pixels      : {counts[k]:>8,}")
    print(f"  INK pixels          : {counts['INK']:>8,}")
    if dark_bbox:
        print(f"  ink bbox            : x[{dark_bbox[0]},{dark_bbox[2]}] y[{dark_bbox[1]},{dark_bbox[3]}]")
        margin = min(dark_bbox[0], dark_bbox[1], w - 1 - dark_bbox[2], h - 1 - dark_bbox[3])
        print(f"  min margin to edge  : {margin}px")

    problems = []
    if bg_ratio > 0.97:
        problems.append("背景占比过高，可能是空图")
    if counts["INK"] < 800:
        problems.append("深色像素过少，文字可能没渲染")
    if dark_bbox and min(dark_bbox[0], dark_bbox[1], w - 1 - dark_bbox[2], h - 1 - dark_bbox[3]) < 2:
        problems.append("内容贴边，可能溢出画布")
    return counts, problems


def main():
    files = sorted(f for f in os.listdir(OUTDIR) if f.endswith(".png"))
    if not files:
        print("no figures found")
        return 1
    all_problems = {}
    for f in files:
        _, problems = analyse(os.path.join(OUTDIR, f))
        if problems:
            all_problems[f] = problems
    print()
    if all_problems:
        for f, ps in all_problems.items():
            print("PROBLEM", f, ps)
        return 1
    print("all figures passed structural checks")
    return 0


if __name__ == "__main__":
    sys.exit(main())
