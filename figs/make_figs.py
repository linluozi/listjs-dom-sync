"""
为 list.js 热路径优化报告生成配图。

数据源：deliver/listjs-dom-sync/results/summary.json（报告里每个数字的唯一来源）。
风格：暖色编辑风，PAPER 底 + INK 字，AMBER/TERRACOTTA/OLIVE 强调。
"""

import json
import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from matplotlib.patches import Patch

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 同一份脚本在工作区（deliver/listjs-dom-sync/...）和仓库根（results/...）都能跑
_CANDIDATES = [
    os.path.join(ROOT, "results", "summary.json"),
    os.path.join(ROOT, "deliver", "listjs-dom-sync", "results", "summary.json"),
]
SUMMARY = next(p for p in _CANDIDATES if os.path.exists(p))
OUTDIR = os.path.join(os.path.dirname(os.path.dirname(SUMMARY)), "docs", "figures")

INK = "#2b2119"
PAPER = "#faf6f0"
AMBER = "#c8892b"
TERRA = "#b4552f"
OLIVE = "#6b6b3a"
MUTED = "#8a7a68"
GRID = "#ddd2c4"

plt.rcParams.update(
    {
        "font.family": "DejaVu Sans",
        "font.size": 8.5,
        "figure.facecolor": PAPER,
        "axes.facecolor": PAPER,
        "savefig.facecolor": PAPER,
        "text.color": INK,
        "axes.labelcolor": INK,
        "xtick.color": MUTED,
        "ytick.color": MUTED,
        "axes.edgecolor": GRID,
        "axes.linewidth": 0.8,
    }
)

with open(SUMMARY, encoding="utf-8") as fh:
    S = json.load(fh)

W = S["browser"]["n2000"]["workloads"]

# 按「可判定收益」从强到弱排列，并给出可读标题
ORDER = [
    ("typing", "Typing\n8 keystrokes"),
    ("repeat", "Repeat query\nsame word x5"),
    ("paging", "Paging\nall / 100 / all"),
    ("sorting", "Sorting\nasc / desc / asc"),
    ("filtering", "Filtering\nnarrow / reset"),
]


def med(workload, arm, metric):
    return W[workload][arm][metric]["median"]


def pct(up, pa):
    if up == 0:
        return "n/a"
    return f"{(pa - up) / up * 100:+.0f}%"


def style(ax, title=None):
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.set_axisbelow(True)
    ax.grid(axis="x", color=GRID, linewidth=0.7, alpha=0.9)
    if title:
        ax.set_title(title, loc="left", fontsize=9.5, color=INK, pad=8)


# ---------------------------------------------------------------- figure 1
def fig_dom_mutations():
    fig, ax = plt.subplots(figsize=(7.2, 3.5))
    n = len(ORDER)
    h = 0.34
    ys = list(range(n))[::-1]

    up_vals = [med(w, "upstream", "domTotal") for w, _ in ORDER]
    pa_vals = [med(w, "patched", "domTotal") for w, _ in ORDER]

    for i, y in enumerate(ys):
        ax.barh(y + h / 2 + 0.02, up_vals[i], height=h, color=TERRA, zorder=3)
        ax.barh(y - h / 2 - 0.02, pa_vals[i], height=h, color=OLIVE, zorder=3)
        ax.text(
            up_vals[i] + 120, y + h / 2 + 0.02, f"{up_vals[i]:,}",
            va="center", ha="left", fontsize=8, color=TERRA,
        )
        ax.text(
            pa_vals[i] + 120, y - h / 2 - 0.02, f"{pa_vals[i]:,}  ({pct(up_vals[i], pa_vals[i])})",
            va="center", ha="left", fontsize=8, color=OLIVE,
        )

    ax.set_yticks(ys)
    ax.set_yticklabels([label for _, label in ORDER], fontsize=8, color=INK, linespacing=1.3)
    ax.set_xlabel("DOM mutations on the list container (count, 2,000 rows)", fontsize=8, color=MUTED)
    ax.set_xlim(0, max(up_vals) * 1.22)
    style(ax)

    ax.legend(
        handles=[Patch(facecolor=TERRA, label="upstream v2.3.1"),
                 Patch(facecolor=OLIVE, label="patched")],
        loc="upper center", bbox_to_anchor=(0.5, -0.16),
        ncol=2, frameon=False, fontsize=8,
    )
    ax.set_title("Every update() rebuilds the whole list — even when nothing changed",
                 loc="left", fontsize=10, color=INK, pad=10)
    fig.tight_layout()
    fig.savefig(os.path.join(OUTDIR, "fig1-dom-mutations.png"), dpi=200, bbox_inches="tight")
    plt.close(fig)


# ---------------------------------------------------------------- figure 2
def fig_layout_iqr():
    fig, ax = plt.subplots(figsize=(7.2, 3.6))
    n = len(ORDER)
    ys = list(range(n))[::-1]

    for i, y in enumerate(ys):
        for arm, color, off in (("upstream", TERRA, 0.16), ("patched", OLIVE, -0.16)):
            st = W[ORDER[i][0]][arm]["layoutDurationMs"]
            yy = y + off
            # 全距细线
            ax.plot([st["min"], st["max"]], [yy, yy], color=color, linewidth=0.9, alpha=0.55, zorder=2)
            # IQR 粗条
            ax.plot([st["q1"], st["q3"]], [yy, yy], color=color, linewidth=7,
                    solid_capstyle="butt", zorder=3)
            # 中位数白心点
            ax.plot([st["median"]], [yy], marker="o", markersize=4.6, markerfacecolor=PAPER,
                    markeredgecolor=color, markeredgewidth=1.4, zorder=4)
            ax.text(st["max"] + 1.6, yy, f"{st['median']:.1f} ms", va="center", ha="left",
                    fontsize=7.5, color=color)

    ax.set_yticks(ys)
    ax.set_yticklabels([label for _, label in ORDER], fontsize=8, color=INK, linespacing=1.3)
    ax.set_xlabel("Cumulative layout duration per workload (ms, 9 rounds, 2,000 rows)", fontsize=8, color=MUTED)
    ax.set_xlim(0, 120)
    style(ax)

    handles = [
        Line2D([0], [0], color=TERRA, linewidth=7, label="upstream  IQR"),
        Line2D([0], [0], color=OLIVE, linewidth=7, label="patched  IQR"),
        Line2D([0], [0], marker="o", color="none", markerfacecolor=PAPER, markeredgecolor=MUTED,
               markeredgewidth=1.4, markersize=4.6, label="median"),
        Line2D([0], [0], color=MUTED, linewidth=0.9, alpha=0.55, label="min–max"),
    ]
    ax.legend(handles=handles, loc="upper center", bbox_to_anchor=(0.5, -0.17),
              ncol=4, frameon=False, fontsize=7.5, handlelength=1.6, columnspacing=1.4)
    ax.set_title("Layout time: where the jank actually goes",
                 loc="left", fontsize=10, color=INK, pad=10)
    fig.tight_layout()
    fig.savefig(os.path.join(OUTDIR, "fig2-layout-iqr.png"), dpi=200, bbox_inches="tight")
    plt.close(fig)


# ---------------------------------------------------------------- figure 3
def fig_attribution():
    arms = ["upstream", "A", "AB", "ABC"]
    labels = ["upstream", "A\n+sync", "AB\n+lower cache", "ABC\n+comparator"]
    steps = ["search_a", "search_ann", "sort_name"]
    titles = [
        "search('a') → DOM mutations",
        "search('ann') → toLowerCase()",
        "sort() → alphabet setter",
    ]
    keys = ["domMutations", "toLowerCase", "alphabetSet"]
    colors = [TERRA, AMBER, OLIVE]

    fig, axes = plt.subplots(1, 3, figsize=(7.2, 2.9))
    for ax, step, title, key, color in zip(axes, steps, titles, keys, colors):
        vals = [S["arms"][a]["steps"][step][key] for a in arms]
        xs = list(range(len(arms)))
        ax.bar(xs, vals, width=0.58, color=color, zorder=3)
        for x, v in zip(xs, vals):
            ax.text(x, v + max(vals) * 0.04, f"{v:,}", ha="center", va="bottom",
                    fontsize=7.5, color=INK)
        ax.set_xticks(xs)
        ax.set_xticklabels(labels, fontsize=6.8, color=MUTED, linespacing=1.25)
        ax.set_ylim(0, max(vals) * 1.24 if max(vals) else 1)
        ax.set_title(title, loc="left", fontsize=8.5, color=INK, pad=6)
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
        ax.set_axisbelow(True)
        ax.grid(axis="y", color=GRID, linewidth=0.7, alpha=0.9)
        ax.tick_params(axis="y", labelsize=7)

    fig.suptitle("Each fix owns exactly one counter (2,000 rows)",
                 x=0.012, ha="left", fontsize=10, color=INK, y=1.03)
    fig.tight_layout()
    fig.savefig(os.path.join(OUTDIR, "fig3-attribution.png"), dpi=200, bbox_inches="tight")
    plt.close(fig)


def main():
    os.makedirs(OUTDIR, exist_ok=True)
    fig_dom_mutations()
    fig_layout_iqr()
    fig_attribution()
    for f in sorted(os.listdir(OUTDIR)):
        p = os.path.join(OUTDIR, f)
        print(f, os.path.getsize(p), "bytes")


if __name__ == "__main__":
    main()
