# NOTICE

本目录包含第三方开源项目 **list.js** 的修改版本，仅用于性能分析与优化示范。

## 上游

- 项目：list.js
- 仓库：https://github.com/javve/list.js
- 版本：v2.3.1
- 提交：`e9312b074f7d8d9a6a5cb67beb8a480115ed3886`
- 许可证：MIT（见同目录 `LICENSE`，逐字节未改动，1108 字节，SHA-256 `52803c32bada68902795d4809ee8133bcbaf8ded276b13bdcef7185d04e86261`）
- 版权：Copyright (c) 2011-2018 Jonny Strömberg, jonnystromberg.com

## 本版本的改动

相对 v2.3.1，改动仅限下列 4 个源文件，未改动 `LICENSE`、未改动公开 API、未新增运行时依赖：

| 文件 | 改动 |
|---|---|
| `src/templater.js` | 新增 `sync(items)`：增量同步容器子节点到目标顺序 |
| `src/index.js` | `update()` 改为收集目标序列后调用 `templater.sync()`，不再 `clear()` + 逐个 `appendChild` |
| `src/search.js` | 删除 `prepare.resetList()` 中多余的 `templater.clear()`；新增按 `(item, 列)` 的小写化缓存；`item.values()` 提到列循环外 |
| `src/sort.js` | `naturalSort` 选取、`alphabet` 赋值、`insensitive` 判断从比较器内部提到排序循环外 |

新增文件：

| 文件 | 说明 |
|---|---|
| `__test__/dom-churn.test.js` | 9 条 DOM 变更预算与语义保护测试（其中 3 条在上游实现上失败） |
| `patches/listjs-dom-sync.patch` | 上述 4 个文件的统一 diff（`-p1`，LF） |
| `bench/`、`probe/` | 基准与验证脚本，不参与库的运行时 |
| `results/` | 原始样本与聚合结果 |

完整补丁见 `patches/listjs-dom-sync.patch`，逐行说明见 `REPORT.md` §4。

## 分发说明

按 MIT 许可证要求，再分发时须保留原版权声明与许可声明。本目录的 `LICENSE` 即为原文件，请勿替换。
