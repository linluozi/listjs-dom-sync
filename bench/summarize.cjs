/**
 * 把原始样本聚合成报告里引用的唯一数字源：results/summary.json。
 * 报告中的每个数字都必须能在这里找到对应字段。
 */
'use strict'

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'out')
const RES = path.join(ROOT, 'deliver', 'results')

const quantile = (arr, p) => {
  const b = arr.slice().sort((x, y) => x - y)
  const i = (b.length - 1) * p
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  return b[lo] + (b[hi] - b[lo]) * (i - lo)
}

const stat = (arr) => ({
  median: quantile(arr, 0.5),
  q1: quantile(arr, 0.25),
  q3: quantile(arr, 0.75),
  min: Math.min.apply(null, arr),
  max: Math.max.apply(null, arr),
  n: arr.length,
})

const METRICS = ['domTotal', 'scriptMs', 'layoutDurationMs', 'recalcStyleDurationMs', 'maxGap']

function summarizeBrowser(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  const groups = {}
  for (const s of data.samples) {
    const k = s.workload + '|' + s.arm
    if (!groups[k]) groups[k] = []
    groups[k].push(s)
  }
  const out = { n: data.n, rounds: data.rounds, workloads: {} }
  const workloads = Array.from(new Set(data.samples.map((s) => s.workload)))
  for (const wl of workloads) {
    out.workloads[wl] = {}
    for (const arm of ['upstream', 'patched']) {
      const rs = groups[wl + '|' + arm]
      if (!rs) continue
      const m = {}
      for (const metric of METRICS) m[metric] = stat(rs.map((r) => r[metric]))
      out.workloads[wl][arm] = m
    }
    const u = out.workloads[wl].upstream
    const p = out.workloads[wl].patched
    if (u && p) {
      out.workloads[wl].ratio = {}
      for (const metric of METRICS) {
        out.workloads[wl].ratio[metric] = u[metric].median > 0 ? p[metric].median / u[metric].median : null
      }
      // 两个中位数区间是否分离：用 IQR 不重叠作为「可判定」的粗判据
      out.workloads[wl].iqrSeparated = {}
      for (const metric of METRICS) {
        out.workloads[wl].iqrSeparated[metric] = p[metric].q3 < u[metric].q1
      }
    }
  }
  return out
}

function summarizeArms() {
  const arms = ['upstream', 'A', 'AB', 'ABC']
  const res = {}
  for (const a of arms) {
    const f = path.join(OUT, 'arm_' + a + '_2000.json')
    if (!fs.existsSync(f)) continue
    const d = JSON.parse(fs.readFileSync(f, 'utf8'))
    const steps = {}
    for (const [k, v] of Object.entries(d.steps)) {
      steps[k] = {
        domMutations: v.delta.appendChildToList + v.delta.removeChildFromList + v.delta.insertBeforeToList,
        toLowerCase: v.delta.toLowerCase,
        valuesCalls: v.delta.valuesCalls,
        alphabetSet: v.delta.alphabetSet,
        visible: v.state.visible,
      }
    }
    res[a] = { n: d.n, steps }
  }
  return res
}

function main() {
  fs.mkdirSync(RES, { recursive: true })
  const summary = {
    project: 'list.js',
    upstreamTag: 'v2.3.1',
    upstreamCommit: 'e9312b074f7d8d9a6a5cb67beb8a480115ed3886',
    upstreamMasterHead: '44ae2396072a617f6a418b5d10c5adbcbc34842f',
    license: 'MIT',
    licenseSha256: '52803c32bada68902795d4809ee8133bcbaf8ded276b13bdcef7185d04e86261',
    licenseBytes: 1108,
    generatedAt: new Date().toISOString(),
    browser: {},
    arms: summarizeArms(),
  }
  for (const n of [2000, 5000]) {
    const f = path.join(OUT, 'browser_' + n + '.json')
    if (fs.existsSync(f)) summary.browser['n' + n] = summarizeBrowser(f)
  }
  fs.writeFileSync(path.join(RES, 'summary.json'), JSON.stringify(summary, null, 2))
  process.stdout.write('summary written\n')
}

main()
