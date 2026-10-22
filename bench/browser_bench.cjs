/**
 * 浏览器级基准：Playwright + Edge，逐帧执行一次操作，让浏览器真实完成
 * 样式重算与布局，再用 CDP Performance 指标与 rAF 帧间隔量化卡顿。
 *
 * 用法：
 *   node browser_bench.cjs --rounds 7 --n 2000 --out ../out/browser_2000.json
 *
 * 每个 (arm, workload, round) 都用一个全新的 browser context，避免状态串扰。
 * 轮次内两臂交错执行，最终按 (arm, workload) 取中位数与 IQR。
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')

const ROOT = path.resolve(__dirname, '..')
const ARMS = {
  upstream: path.join(ROOT, 'upstream', 'dist', 'list.js'),
  patched: path.join(ROOT, 'patched', 'dist', 'list.js'),
}

function parseArgs(argv) {
  const out = { rounds: 7, n: 2000, out: null, warmup: 1 }
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i]
    if (k === '--rounds') out.rounds = parseInt(argv[++i], 10)
    else if (k === '--n') out.n = parseInt(argv[++i], 10)
    else if (k === '--out') out.out = argv[++i]
    else if (k === '--warmup') out.warmup = parseInt(argv[++i], 10)
  }
  return out
}

const FIRST = ['Ava', 'Liam', 'Noah', 'Emma', 'Olivia', 'Mason', 'Sophia', 'Lucas', 'Mia', 'Ethan']
const LAST = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez']
const CITY = ['Springfield', 'Riverside', 'Franklin', 'Greenville', 'Clinton', 'Fairview', 'Salem', 'Madison', 'Georgetown', 'Arlington']

function buildHtml(n) {
  const rows = []
  for (let i = 0; i < n; i++) {
    const name = FIRST[i % FIRST.length] + ' ' + LAST[(i * 7) % LAST.length]
    const city = CITY[(i * 3) % CITY.length]
    const age = 18 + (i % 60)
    rows.push(
      '<li class="item"><span class="name">' + name + '</span>' +
      '<span class="city">' + city + '</span>' +
      '<span class="age">' + age + '</span></li>'
    )
  }
  return (
    '<!doctype html><html><head><meta charset="utf-8"><style>' +
    'body{margin:0;font:14px/1.4 system-ui,sans-serif}' +
    '.item{display:block;padding:2px 8px;border-bottom:1px solid #eee}' +
    '</style></head><body>' +
    '<div id="users"><input class="search" />' +
    '<span class="sort" data-sort="name">name</span>' +
    '<span class="sort" data-sort="age">age</span>' +
    '<ul class="list">' + rows.join('') + '</ul></div></body></html>'
  )
}

/**
 * 每个 workload 都在页面内逐步执行：一次操作 -> 强制结算布局 -> 下一次。
 * 强制读一次 offsetHeight 让浏览器立刻完成样式重算与布局，这样每次操作的
 * DOM 成本都能被单独结算，而不是被帧末合并成一次。
 *
 * 同时在页面内 patch DOM API 做确定性计数：耗时会被 JIT 和机器状态影响，
 * 变更次数不会。
 */
const WORKLOADS = {
  // 模拟用户逐字符输入 "martinez"
  typing: {
    steps: 8,
    run: `async (step) => {
      const words = ['m','ma','mar','mart','marti','martin','martine','martinez']
      const t = performance.now()
      window.__list.search(words[step])
      return performance.now() - t
    }`,
  },
  // 反复排序：升 -> 降 -> 升
  sorting: {
    steps: 3,
    run: `async (step) => {
      const t = performance.now()
      window.__list.sort('name', { order: step % 2 === 0 ? 'asc' : 'desc' })
      return performance.now() - t
    }`,
  },
  // 带自定义 alphabet 的排序：上游在比较器内部给 naturalSort.alphabet 赋值，
  // 而该属性是 setter，每次赋值都会重建整张 alphabetIndexMap。
  sortingAlphabet: {
    steps: 2,
    run: `async (step) => {
      window.__list.alphabet = 'zyxwvutsrqponmlkjihgfedcba ZYXWVUTSRQPONMLKJIHGFEDCBA'
      const t = performance.now()
      window.__list.sort('name', { order: step % 2 === 0 ? 'asc' : 'desc' })
      return performance.now() - t
    }`,
  },
  // 过滤收窄再复位（复位后顺序与集合完全回到初始，是「零变更」的理想场景）
  filtering: {
    steps: 2,
    run: `async (step) => {
      const t = performance.now()
      if (step === 0) window.__list.filter((i) => i.values().city === 'Salem')
      else window.__list.filter(() => true)
      return performance.now() - t
    }`,
  },
  // 分页：全量 -> 每页 100 -> 全量
  paging: {
    steps: 3,
    run: `async (step) => {
      const t = performance.now()
      window.__list.show(1, step === 1 ? 100 : 10000)
      return performance.now() - t
    }`,
  },
  // 同一查询重复触发（防抖失效、重复提交等常见情况）
  repeat: {
    steps: 5,
    run: `async (step) => {
      const t = performance.now()
      window.__list.search('an')
      return performance.now() - t
    }`,
  },
}

async function runOne(browser, armName, workloadName, n) {
  const context = await browser.newContext()
  const page = await context.newPage()
  const client = await context.newCDPSession(page)

  await page.setContent(buildHtml(n), { waitUntil: 'load' })
  await page.addScriptTag({ path: ARMS[armName] })
  await page.evaluate(() => {
    window.__list = new List('users', {
      valueNames: ['name', 'city', 'age'],
      item: '<li class="item"><span class="name"></span><span class="city"></span><span class="age"></span></li>',
    })
  })

  // 初始化后强制一次布局，让基线干净
  await page.evaluate(() => document.body.offsetHeight)

  // 页面内 DOM 计数：只统计直接作用于列表容器的变更
  await page.evaluate(() => {
    const container = document.querySelector('#users .list')
    const c = { append: 0, remove: 0, insert: 0 }
    window.__domCounts = c
    const p = Node.prototype
    const oa = p.appendChild
    p.appendChild = function (child) {
      if (this === container) c.append++
      return oa.call(this, child)
    }
    const or = p.removeChild
    p.removeChild = function (child) {
      if (this === container) c.remove++
      return or.call(this, child)
    }
    const oi = p.insertBefore
    p.insertBefore = function (child, ref) {
      if (this === container) c.insert++
      return oi.call(this, child, ref)
    }
  })

  await client.send('Performance.enable')
  const before = await client.send('Performance.getMetrics')

  const wl = WORKLOADS[workloadName]
  const result = await page.evaluate(
    async ({ runSrc, steps }) => {
      const fn = eval('(' + runSrc + ')')
      const stepMs = []
      const gaps = []
      const perStep = []
      let last = performance.now()
      for (let s = 0; s < steps; s++) {
        const ms = await fn(s)
        stepMs.push(ms)
        // 强制结算：让本次操作的样式重算与布局立刻发生
        document.body.offsetHeight
        const now = performance.now()
        gaps.push(now - last)
        last = now
        perStep.push({ ...window.__domCounts })
      }
      return { stepMs, gaps, perStep, counts: window.__domCounts }
    },
    { runSrc: wl.run, steps: wl.steps }
  )

  // 收尾强制一次布局，确保最后一批变更已结算
  await page.evaluate(() => document.body.offsetHeight)
  const after = await client.send('Performance.getMetrics')

  const metricDelta = {}
  for (const m of after.metrics) {
    const prev = before.metrics.find((x) => x.name === m.name)
    if (prev) metricDelta[m.name] = m.value - prev.value
  }

  await context.close()

  const sum = (arr) => arr.reduce((a, b) => a + b, 0)
  return {
    arm: armName,
    workload: workloadName,
    n,
    scriptMs: sum(result.stepMs),
    stepMs: result.stepMs,
    frameGaps: result.gaps,
    maxGap: Math.max.apply(null, result.gaps),
    domAppend: result.counts.append,
    domRemove: result.counts.remove,
    domInsert: result.counts.insert,
    domTotal: result.counts.append + result.counts.remove + result.counts.insert,
    layoutCount: metricDelta.LayoutCount || 0,
    recalcStyleCount: metricDelta.RecalcStyleCount || 0,
    layoutDurationMs: (metricDelta.LayoutDuration || 0) * 1000,
    recalcStyleDurationMs: (metricDelta.RecalcStyleDuration || 0) * 1000,
    scriptDurationMs: (metricDelta.ScriptDuration || 0) * 1000,
    taskDurationMs: (metricDelta.TaskDuration || 0) * 1000,
  }
}

async function main() {
  const args = parseArgs(process.argv)
  const browser = await chromium.launch({ channel: 'msedge', headless: true })

  const samples = []
  const workloads = Object.keys(WORKLOADS)
  const arms = Object.keys(ARMS)

  // 预热：让 JIT 与浏览器缓存进入稳定态（不计入样本）
  for (let w = 0; w < args.warmup; w++) {
    for (const wl of workloads) {
      for (const arm of arms) {
        await runOne(browser, arm, wl, args.n)
      }
    }
  }

  for (let r = 0; r < args.rounds; r++) {
    for (const wl of workloads) {
      for (const arm of arms) {
        const rec = await runOne(browser, arm, wl, args.n)
        rec.round = r
        samples.push(rec)
      }
    }
  }

  await browser.close()

  const payload = { n: args.n, rounds: args.rounds, samples }
  if (args.out) {
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true })
    fs.writeFileSync(args.out, JSON.stringify(payload, null, 2))
  }
  process.stdout.write(JSON.stringify({ ok: true, samples: samples.length }) + '\n')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
