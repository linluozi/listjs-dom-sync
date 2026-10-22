# list.js v2.3.1 — 列表重绘热路径优化

上游：[`javve/list.js`](https://github.com/javve/list.js) v2.3.1（MIT）。

这个包是 list.js 的一个优化分支，只改动了列表重绘路径上的三处浪费，公开 API 不变。

## 改了什么

1. **增量 DOM 同步** — `update()` 不再清空容器后全量重挂，改为只移除消失的、只移动位置不对的节点。
2. **搜索小写缓存** — 不再对每个 item × 每一列在每次按键时重复 `toLowerCase()`。
3. **排序比较器前置化** — `naturalSort` 的选取与 `alphabet` 赋值从比较器内部提到排序循环外（`alphabet` 是带 setter 的访问器，每次赋值都会重建索引表）。

详细分析、测量方法与原始数据见 `REPORT.md`。

## 效果（Microsoft Edge，CDP 指标，IQR 分离才算数）

| 场景（2000 行） | DOM 变更 | 布局耗时 | 样式重算 |
|---|---|---|---|
| 逐字符输入 | 9400 → 1800 | 53.2 → 2.2 ms | 27.2 → 0.2 ms |
| 分页切换 | 8200 → 3800 | 62.5 → 27.9 ms | 31.8 → 13.6 ms |
| 重复查询 | 5600 → 1600 | 31.3 → 0.4 ms | 15.0 → 0.0 ms |

普通排序场景的 DOM 次数下降但端到端耗时**测不出改善**，原因见 `REPORT.md` §7——这一项不计入成果。

## 快速开始

```bash
npm install
npx jest
```

期望：`168 passed / 1 skipped`（上游原有），加上 `__test__/dom-churn.test.js` 的 9 条。

构建：

```bash
NODE_OPTIONS=--openssl-legacy-provider npm run build
```

`--openssl-legacy-provider` 是 Node 17+ 与 webpack 5.6 的 md4 兼容所需，与本次改动无关。

## 目录

```
src/                 修改后的源码（IE9 目标，无 ES6 内置对象）
__test__/            上游测试 + dom-churn.test.js
dist/                构建产物
patches/             相对 v2.3.1 的统一 diff（-p1）
bench/               浏览器基准（Playwright + CDP）与聚合脚本
probe/               确定性计数器、差分等价性、变体生成
results/             summary.json 与原始样本
REPORT.md            完整报告
NOTICE.md            改动声明
LICENSE              上游 MIT，逐字节未改
```

## 基准复现

```bash
npm i -D playwright            # 使用系统 Edge，无需下载浏览器
node bench/browser_bench.cjs --rounds 9 --n 2000 --out out/browser_2000.json
node bench/summarize.cjs
```

上游基线需单独获取 v2.3.1 源码放在同级 `upstream/` 目录，`bench/browser_bench.cjs` 与 `probe/equivalence.cjs` 都按该约定读取两臂。

## 许可

MIT，见 `LICENSE`。改动声明见 `NOTICE.md`。
