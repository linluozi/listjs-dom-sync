# list.js 列表渲染热路径优化

> 目标项目：[`javve/list.js`](https://github.com/javve/list.js) v2.3.1（MIT）
> 优化对象：`search` / `filter` / `sort` / `show` 触发的列表重绘路径
> 报告日期：2026-10-22

---

## 1. 结论

`list.js` 的列表重绘路径存在一处结构性浪费：**每次 `update()` 都把容器里的 DOM 全部拆掉再重新挂回**。可见集合与顺序完全没变时，同样要付出 2N 次 DOM 变更。围绕这一点还有两处无效计算：搜索对每个 item × 每一列重复小写化、排序在比较器内部重复解析 `naturalSort` 配置。

三处修改合计约 90 行（含注释），不改变任何公开 API，不引入 ES6 内置对象（保持 `.browserslistrc` 声明的 IE9 目标）。

**可判定收益**（两档规模下 IQR 均分离）：

| 场景 | DOM 变更次数 | 布局耗时 | 样式重算耗时 |
|---|---|---|---|
| 逐字符输入（8 次按键，2000 行） | 9400 → 1800（−81%） | 53.2 → 2.2 ms（−96%） | 27.2 → 0.2 ms（−99%） |
| 逐字符输入（5000 行） | 23500 → 4500（−81%） | 139.7 → 5.9 ms（−96%） | 68.6 → 0.3 ms（−99.6%） |
| 分页切换（2000 行） | 8200 → 3800（−54%） | 62.5 → 27.9 ms（−55%） | 31.8 → 13.6 ms（−57%） |
| 重复查询（2000 行） | 5600 → 1600（−71%） | 31.3 → 0.4 ms（−99%） | 15.0 → 0.0 ms（−100%） |

**未能判定收益**：普通排序（`sorting`）。DOM 变更次数确实从 12000 降到 5396，但布局与脚本耗时两档规模的 IQR 均重叠，只能记为「测不出」。原因见 §7。

![DOM mutations per workload](docs/figures/fig1-dom-mutations.png)

*2000 行，9 轮交错中位数。计数在页面内 patch `appendChild` / `removeChild` / `insertBefore` 得到。数据源：`results/summary.json` → `browser.n2000.workloads.*.domTotal`。*

---

## 2. 目标与许可证

| 项 | 值 |
|---|---|
| 仓库 | `javve/list.js` |
| 版本 | v2.3.1（tag `e9312b074f7d8d9a6a5cb67beb8a480115ed3886`） |
| master HEAD | `44ae2396072a617f6a418b5d10c5adbcbc34842f`（`src/` 与 `__test__/` 与 v2.3.1 逐字节相同，已 `diff -r` 验证） |
| 许可证 | MIT |
| LICENSE 文件 | 1108 字节，SHA-256 `52803c32bada68902795d4809ee8133bcbaf8ded276b13bdcef7185d04e86261` |
| 核实方式 | 与 `GET /repos/javve/list.js/contents/LICENSE?ref=v2.3.1` 返回的 blob 逐字节比对，`raw == local` 为 `True` |
| 修改声明 | 见 `NOTICE.md`；`LICENSE` 未做任何改动 |

许可证允许修改与再分发，唯一义务是保留版权与许可声明。本交付保留原 `LICENSE` 原样，并在 `NOTICE.md` 中声明改动范围。

---

## 3. 定位方法：先数次数，再计时

计时在浏览器里噪声大（JIT、GC、调度），而「改了多少次 DOM」是确定性的。因此先用插桩把行为量化，再让计时去验证代价。

在 jsdom 中对 `Node.prototype.appendChild / removeChild / insertBefore`、`String.prototype.toLowerCase`、`Element.prototype.getAttribute` 做计数，跑固定操作序列（2000 行 × 3 列）。上游结果：

| 操作 | 容器级 DOM 变更 | `toLowerCase` | `values()` |
|---|---|---|---|
| `search('a')` | 4000 | 2001 | 2001 |
| `search('an')` | 2400 | 5401 | 5401 |
| `search('ann')` | 400 | 6001 | 6001 |
| `sort('name')` | 4000 | 27808 | 27808 |
| `filter(city)` | 2200 | 0 | 2000 |
| `show(1, 100)` | 2100 | 0 | 0 |

三处异常：

1. **`search('a')` 命中 2000 行、DOM 里本来就有 2000 行，却仍然做了 2000 次 `removeChild` + 2000 次 `appendChild`。** 根因在 `index.js` 的 `update()`：先 `templater.clear()` 清空容器，再对可见项逐个 `appendChild`。`search.js` 的 `prepare.resetList()` 里还有一次多余的 `templater.clear()`，同一次搜索清空两遍。
2. **`search('ann')` 命中 0 行，仍做了 6001 次 `toLowerCase`。** `search.js` 的内层循环每次按键都重新小写化所有 item 的所有列，而 item 的值在两次按键之间通常没变。
3. **`sort` 一次产生 27808 次 `toLowerCase`、13904 次 `naturalSort.alphabet` 赋值。** `sort.js` 把「选哪个比较函数、设置 alphabet、判断 insensitive」全写在比较器内部，n·log n 次比较就执行 n·log n 遍。而 `alphabet` 是带 setter 的访问器，每次赋值都会重建整张 `alphabetIndexMap`。

---

## 4. 修改内容

补丁：`patches/listjs-dom-sync.patch`（7529 字节，10 个 hunk，LF 行尾，`-p1`）。已验证可精确还原：在干净基线上 `git apply` 后，4 个文件与 `src/` 逐字节相同。

### 4.1 增量 DOM 同步（`templater.js` + `index.js` + `search.js`）

`templater.js` 新增 `sync(items)`：

1. 对目标项调 `create()`（对已有 `elm` 是 no-op）；
2. 给目标节点打本轮递增 token，单次遍历移除所有非目标子节点——**包括非 item 节点，与原 `clear()` 的「清空容器」语义一致**；
3. 单次前向扫描按序就位，只对位置不对的节点调用 `insertBefore`。

`index.js` 的 `update()` 改为先一趟循环收集 `matching` / `visible`，再调 `templater.sync(visible)`。分页条件与原实现等价：原代码在 push 前判 `matchingItems.length + 1 >= i`，新代码在 push 后判 `matching.length >= i`，两者恒等。

`search.js` 删掉 `prepare.resetList()` 里多余的 `list.templater.clear()`——`update()` 自己会同步。

不使用 `Set` / `WeakMap`，保持 IE9 兼容。

### 4.2 搜索小写缓存（`search.js`）

按 `(item, 列名)` 缓存 `toLowerCase` 结果，并用缓存时的原文做严格相等校验：

```js
entry = cache['$' + column]
if (entry !== undefined && entry.text === text) return entry.lower
```

值被改写后原文必然不同，缓存自动失效，不需要显式失效钩子。缓存挂在 item 上随 item 回收；键加 `$` 前缀避免 `__proto__` 之类列名污染原型链。同时把 `item.values()` 从列循环内提到循环外（返回的是同一个 `_values` 引用）。

### 4.3 排序比较器前置化（`sort.js`）

把 `naturalSort` 的选取、`alphabet` 赋值、`insensitive` 判断提到 `sortFunction` 创建时，整轮排序只做一次。语义与原实现一致：原来每次比较都设成同一个值，提到外层只设一次。

**未采用**「预提取排序键 + 预小写」。实测在 2000 行规模下端到端无可测收益（`scriptMs` 比值 1.06，IQR 重叠），按最小改动原则不引入 item 上的额外属性与字符串副本。

---

## 5. 测量结果

### 5.1 环境与口径

- 浏览器：Microsoft Edge（Playwright `channel: 'msedge'`，headless）
- 每个 `(arm, workload, round)` 使用全新 browser context
- 预热 1 轮不计入样本；`n=2000` 跑 9 轮，`n=5000` 跑 7 轮
- 轮次内两臂交错执行，取中位数与 IQR
- 每次操作后读一次 `document.body.offsetHeight` 强制结算布局，使单次操作的样式重算与布局不被帧末合并
- 指标来自 CDP `Performance.getMetrics` 增量：`LayoutCount`、`RecalcStyleCount`、`LayoutDuration`、`RecalcStyleDuration`、`ScriptDuration`
- DOM 变更次数在页面内 patch `appendChild/removeChild/insertBefore` 统计（仅容器级）

**判据**：`patched.q3 < upstream.q1`（IQR 完全不重叠）才记为「可判定」；否则记为「分布重叠，按测不出处理」。原始样本见 `results/browser_2000.json`、`results/browser_5000.json`，聚合值见 `results/summary.json`。

### 5.2 n = 2000

![Layout duration distributions](docs/figures/fig2-layout-iqr.png)

*粗条 = IQR，细线 = 全距，白心点 = 中位数。9 轮，2000 行，每个样本独立 browser context，每步后读 `document.body.offsetHeight` 让单次操作的布局单独结算。数据源：`results/summary.json` → `browser.n2000.workloads.*.layoutDurationMs`。*

| workload | DOM 变更 | scriptMs | layoutMs | recalcMs |
|---|---|---|---|---|
| typing | 9400 → **1800** | 37.8 → 22.9 | 53.2 → **2.2** ✅ | 27.2 → **0.2** ✅ |
| sorting | 12000 → 5396 | 53.1 → 43.6 | 81.0 → 74.8 | 47.7 → 40.8 |
| sortingAlphabet | 8000 → 3600 | 48.5 → 31.5 | 56.0 → 44.5 | 35.0 → 27.6 |
| filtering | 4400 → 3600 | 15.0 → 10.8 | 20.0 → 27.1 | 14.6 → 12.4 |
| paging | 8200 → **3800** | 24.3 → **11.3** ✅ | 62.5 → **27.9** ✅ | 31.8 → **13.6** ✅ |
| repeat | 5600 → **1600** | 28.2 → **16.9** ✅ | 31.3 → **0.4** ✅ | 15.0 → **0.0** ✅ |

✅ = IQR 分离。`filtering` 的 `layoutMs` 在本档反而变大（20.0 → 27.1），但 5000 行档是 110.8 → 80.0，两档方向相反且 IQR 均重叠，按噪声处理，不下结论。

### 5.3 n = 5000

| workload | DOM 变更 | scriptMs | layoutMs | recalcMs |
|---|---|---|---|---|
| typing | 23500 → **4500** | 103.6 → **49.7** ✅ | 139.7 → **5.9** ✅ | 68.6 → **0.3** ✅ |
| sorting | 30000 → 13496 | 117.7 → 117.8 | 194.8 → 184.9 | 111.5 → 106.0 |
| sortingAlphabet | 20000 → 9000 | 115.9 → 77.1 | 148.0 → 110.7 | 71.3 → 61.6 |
| filtering | 11000 → 9000 | 30.1 → 20.0 | 110.8 → **80.0** ✅ | 31.6 → 27.2 |
| paging | 20200 → **9800** | 60.1 → **23.8** ✅ | 152.4 → **75.3** ✅ | 67.7 → **32.9** ✅ |
| repeat | 14000 → **4000** | 67.3 → **30.3** ✅ | 64.6 → **0.9** ✅ | 41.3 → **0.1** ✅ |

`sortingAlphabet` 两档中位数分别降 35% 与 33%，但 IQR 轻微重叠（5000 行档：upstream `[95.2, 130.7]`，patched `[70.6, 97.1]`）。趋势一致、方向明确，但按既定判据不记为「可判定」。

---

## 6. 逐臂归因

![Attribution ladder](docs/figures/fig3-attribution.png)

*三个递进变体隔离贡献：A = 只做增量同步，AB = 加小写缓存，ABC = 加比较器前置化。数据源：`results/summary.json` → `arms.*.steps.*`。*

三处修改分别落在独立文件上，构造三个递进变体隔离贡献（`probe/make_arms.cjs`，自检 ABC 与最终 `src/` 逐字节一致）：

- **A**：增量 DOM 同步（`templater.js` + `index.js` + 去掉 `search.js` 多余 clear）
- **AB**：A + 搜索小写缓存
- **ABC**：AB + 排序比较器前置化（= 交付版）

| 计数项（2000 行） | upstream | A | AB | ABC |
|---|---|---|---|---|
| `search('a')` DOM 变更 | 4000 | **0** | 0 | 0 |
| `search('an')` DOM 变更 | 2400 | **1600** | 1600 | 1600 |
| `sort('name')` DOM 变更 | 4000 | **1796** | 1796 | 1796 |
| `show(1,100)` DOM 变更 | 2100 | **1900** | 1900 | 1900 |
| `search('ann')` toLowerCase | 6001 | 6001 | **601** | 601 |
| `search('ann')` values() | 6001 | 6001 | **2001** | 2001 |
| `sort('name')` alphabet setter | 13904 | 13904 | 13904 | **1** |

归因是干净的正交关系：DOM 次数只被 A 改变，小写化次数只被 B 改变，`alphabet` setter 只被 C 改变。B 与 C 对 DOM 次数零贡献，A 对小写化零贡献。

`alphabet` setter 从 13904 降到 1 的意义：配置了自定义 `alphabet` 时，每次 setter 都要重建整张索引表（62 字符 → 62 次循环 + 数组分配），一次排序会重建上千次。这也是 `sortingAlphabet` 场景出现可测差异的原因。

---

## 7. 负结果：普通排序测不出收益

`sorting` 场景 DOM 变更次数从 12000 降到 5396（−55%），但两档规模的 `scriptMs`、`layoutMs`、`recalcMs` IQR 全部重叠。

原因不是测量问题，而是**操作次数不等于操作成本**：新实现用 `insertBefore` 移动已有节点，旧实现用 `removeChild` + `appendChild` 摘掉再挂回。两者都会让节点脱离文档树再进入，样式失效与布局重算的成本相当，`insertBefore` 还需要在兄弟节点间定位，单次可能更贵。次数少了 55%，总代价没变。

这也说明：如果只看「DOM 操作次数」就宣布排序优化成功，是错的。**排序场景的真实瓶颈不在 DOM 操作次数，而在每次移动都必须重新布局**——这需要虚拟滚动或 `transform` 位移才能解决，超出「最小改动修热路径」的范围。

同理，`filtering` 两档方向相反，也只能记为测不出。

---

## 8. 差分等价性

`probe/equivalence.cjs` 对两臂执行 32 步操作序列，每步后记录：容器 DOM 逐节点 `outerHTML`、`visibleItems` / `matchingItems` 的值序列、每个 item 的 `found` / `filtered` 标志、`toJSON()` 结果。

覆盖：init、多级前缀搜索、搜索复位、filter 收窄与复位、三列排序（asc/desc/数字/`insensitive:false`）、分页来回、`add`、`remove`、原地改写 `values()` 后再搜索、改回原值再搜索（验证缓存命中路径）、fuzzy search、`reIndex`、自定义 `alphabet` 排序、自定义 `sortFunction`。

结果（快照以 gzip 存放，解压后各 1,200,320 字节；验证方法见 `results/EQUIVALENCE.md`）：

```
results/raw/eq_upstream.json.gz  → sha256 e233fe3278b87982302b6fcad37417ee67429a2576d876f5214723abb2d368bc
results/raw/eq_patched.json.gz   → sha256 e233fe3278b87982302b6fcad37417ee67429a2576d876f5214723abb2d368bc
cmp: identical (1,200,320 bytes, 32 steps)
```

既有测试：上游 `168 passed / 1 skipped`，修改后 `168 passed / 1 skipped`，失败集合与通过集合完全一致。

---

## 9. 反向验证

新增 `__test__/dom-churn.test.js`（9 条）。其中前 3 条断言的是「为了得到正确结果动了多少 DOM」，后 6 条是语义保护（顺序一致、非 item 子节点仍被清除、空结果清空容器、缓存失效、add/remove 同步）。

把同一文件放到上游 `src/` 上跑：

```
× issues zero DOM mutations when a repeated search returns the same set
× only removes the items that drop out when a search narrows
× only inserts the items that come back when a filter is reset
√ keeps DOM order identical to visibleItems order after sorting
√ keeps DOM order identical after paging and back
√ still drops non-item children from the container
√ empties the container when nothing matches
√ sees values rewritten between two searches (lowercase cache must invalidate)
√ keeps add/remove in sync with the DOM
Tests: 3 failed, 6 passed, 9 total
```

在交付版上 9 条全绿。前 3 条在上游必红，说明测试有区分力；后 6 条两臂都绿，说明没有为了少动 DOM 而改坏语义。

---

## 10. 局限

1. **未在真实 IE9 上验证。** 只保证不使用 ES6 内置对象、不使用箭头函数/`let`/`const`，并用 babel + `.browserslistrc`（`ie 9`）构建。`insertBefore` 与 DOM 节点 expando 属性在 IE9 均可用，但未实机跑过。
2. **未提交上游。** 上游自 2025-04 后无新提交，`update()` 全量重建是其长期设计（`templater.clear()` 的注释写着「`.innerHTML = ''` fucks up IE」）。是否接受增量同步属维护者判断，本交付只提供证据与补丁。
3. **只覆盖列表重绘路径。** `parse()` 初始化、`pagination.refresh()` 每次重建整个分页条、`get-attribute.js` 的 fallback 线性扫描均未改动——它们是冷路径或规模很小。
4. **`sorting` 与 `filtering` 的收益未成立。** 已在 §7 说明，不列为优化成果。
5. **测量机器为单机单次会话。** 跨会话计时会漂移，因此结论只采用同轮交错样本的 IQR 分离判据；DOM 变更次数是确定性计数，不受此限。

---

## 11. 复现

```bash
npm install
npx jest                                   # 期望 168 passed / 1 skipped + 新增 9 条
NODE_OPTIONS=--openssl-legacy-provider npm run build

# 确定性计数（jsdom）
node probe/count.cjs --src . --n 2000 --label patched --out out/patched_2000.json

# 差分等价性（需与上游副本对比）
node probe/equivalence.cjs --src . --out out/eq_patched.json

# 浏览器基准（需 playwright + 系统 Edge）
npm i -D playwright
node bench/browser_bench.cjs --rounds 9 --n 2000 --out out/browser_2000.json
node bench/summarize.cjs
```

上游基线副本请从 `https://github.com/javve/list.js/archive/refs/tags/v2.3.1.tar.gz` 获取，放在与本目录同级的 `upstream/`。
