/**
 * 确定性计数器探针：量化 list.js 热路径上的 DOM 变更 / 小写化 / 属性读取次数。
 *
 * 用法：
 *   node count.cjs --src <srcDir> --n 2000 --label upstream
 *
 * 输出 JSON 到 stdout（供后续聚合成表），同时把原始结果写入 --out 指定文件。
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { JSDOM } = require('jsdom')

function parseArgs(argv) {
  const out = { n: 2000, src: null, label: 'run', out: null, cols: 3 }
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i]
    if (k === '--n') out.n = parseInt(argv[++i], 10)
    else if (k === '--src') out.src = argv[++i]
    else if (k === '--label') out.label = argv[++i]
    else if (k === '--out') out.out = argv[++i]
    else if (k === '--cols') out.cols = parseInt(argv[++i], 10)
  }
  return out
}

const FIRST = ['Ava', 'Liam', 'Noah', 'Emma', 'Olivia', 'Mason', 'Sophia', 'Lucas', 'Mia', 'Ethan']
const LAST = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez']
const CITY = ['Springfield', 'Riverside', 'Franklin', 'Greenville', 'Clinton', 'Fairview', 'Salem', 'Madison', 'Georgetown', 'Arlington']

function buildRows(n) {
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
  return rows.join('')
}

function buildHtml(n) {
  return (
    '<!doctype html><html><body>' +
    '<div id="users">' +
    '<input class="search" />' +
    '<span class="sort" data-sort="name"></span>' +
    '<span class="sort" data-sort="age"></span>' +
    '<ul class="list">' + buildRows(n) + '</ul>' +
    '</div></body></html>'
  )
}

function main() {
  const args = parseArgs(process.argv)
  if (!args.src) throw new Error('--src required')
  const srcDir = path.resolve(args.src)
  const indexPath = path.join(srcDir, 'src', 'index.js')

  const dom = new JSDOM(buildHtml(args.n), { url: 'http://localhost/' })
  const win = dom.window
  const doc = win.document

  // --- 把 DOM 全局注入，供 CommonJS 版 src 使用 ---
  global.window = win
  global.document = doc
  global.Node = win.Node
  global.Element = win.Element

  const listEl = doc.querySelector('#users .list')
  const inList = (node) => {
    // 判断节点是否是 list 容器的直接子节点操作
    return node === listEl
  }

  // --- 插桩 ---
  const counters = {
    appendChild: 0,
    appendChildToList: 0,
    removeChild: 0,
    removeChildFromList: 0,
    insertBefore: 0,
    insertBeforeToList: 0,
    replaceChild: 0,
    toLowerCase: 0,
    toLowerCaseChars: 0,
    getAttribute: 0,
    setAttribute: 0,
    classAdd: 0,
    classRemove: 0,
    classToggle: 0,
    innerHTMLSet: 0,
    valuesCalls: 0,
    naturalSortCalls: 0,
    alphabetSet: 0,
    createElement: 0,
  }

  const proto = win.Node.prototype
  const origAppend = proto.appendChild
  proto.appendChild = function (child) {
    counters.appendChild++
    if (inList(this)) counters.appendChildToList++
    return origAppend.call(this, child)
  }
  const origRemove = proto.removeChild
  proto.removeChild = function (child) {
    counters.removeChild++
    if (inList(this)) counters.removeChildFromList++
    return origRemove.call(this, child)
  }
  const origInsert = proto.insertBefore
  proto.insertBefore = function (child, ref) {
    counters.insertBefore++
    if (inList(this)) counters.insertBeforeToList++
    return origInsert.call(this, child, ref)
  }
  const origReplace = proto.replaceChild
  proto.replaceChild = function (a, b) {
    counters.replaceChild++
    return origReplace.call(this, a, b)
  }

  // 注意：jsdom 与 node 可能共享同一个 String.prototype（win.String === String）。
  // 若共享则只插桩一次，否则同一调用会被计两次。
  const sharedStringProto = win.String === String
  const origLower = win.String.prototype.toLowerCase
  win.String.prototype.toLowerCase = function () {
    counters.toLowerCase++
    counters.toLowerCaseChars += this.length
    return origLower.call(this)
  }
  if (!sharedStringProto) {
    const nodeLower = String.prototype.toLowerCase
    String.prototype.toLowerCase = function () {
      counters.toLowerCase++
      counters.toLowerCaseChars += this.length
      return nodeLower.call(this)
    }
  }

  const origGetAttr = win.Element.prototype.getAttribute
  win.Element.prototype.getAttribute = function (name) {
    counters.getAttribute++
    return origGetAttr.call(this, name)
  }
  const origSetAttr = win.Element.prototype.setAttribute
  win.Element.prototype.setAttribute = function (name, value) {
    counters.setAttribute++
    return origSetAttr.call(this, name, value)
  }

  const dtl = win.DOMTokenList.prototype
  const origAdd = dtl.add
  dtl.add = function () {
    counters.classAdd++
    return origAdd.apply(this, arguments)
  }
  const origRm = dtl.remove
  dtl.remove = function () {
    counters.classRemove++
    return origRm.apply(this, arguments)
  }
  const origTog = dtl.toggle
  dtl.toggle = function () {
    counters.classToggle++
    return origTog.apply(this, arguments)
  }

  const origCreate = doc.createElement.bind(doc)
  doc.createElement = function () {
    counters.createElement++
    return origCreate.apply(doc, arguments)
  }

  // --- 加载被测实现 ---
  const List = require(indexPath)

  const t0 = process.hrtime.bigint()
  const list = new List('users', {
    valueNames: ['name', 'city', 'age'],
    item: '<li class="item"><span class="name"></span><span class="city"></span><span class="age"></span></li>',
  })
  const initMs = Number(process.hrtime.bigint() - t0) / 1e6

  const snapshotInit = { ...counters }

  // naturalSort.alphabet 是不可重定义的访问器，无法直接包 setter。
  // 用 Proxy 包住实例上的 utils.naturalSort，拦截赋值来统计「重建索引表」次数。
  const realNaturalSort = list.utils.naturalSort
  list.utils.naturalSort = new Proxy(realNaturalSort, {
    apply: function (target, thisArg, args) {
      return Reflect.apply(target, thisArg, args)
    },
    set: function (target, prop, value) {
      if (prop === 'alphabet') counters.alphabetSet++
      return Reflect.set(target, prop, value)
    },
  })

  // 给每个 item 的 values() 加计数（不改行为，只统计）
  for (const it of list.items) {
    const orig = it.values
    it.values = function () {
      counters.valuesCalls++
      return orig.apply(this, arguments)
    }
  }

  const measure = (fn) => {
    const before = { ...counters }
    const s = process.hrtime.bigint()
    fn()
    const ms = Number(process.hrtime.bigint() - s) / 1e6
    const delta = {}
    for (const k of Object.keys(counters)) delta[k] = counters[k] - before[k]
    return {
      ms,
      delta,
      state: {
        visible: list.visibleItems.length,
        matching: list.matchingItems.length,
        domChildren: listEl.childNodes.length,
      },
    }
  }

  const steps = {}
  steps.search_a = measure(() => list.search('a'))
  steps.search_an = measure(() => list.search('an'))
  steps.search_ann = measure(() => list.search('ann'))
  steps.search_empty = measure(() => list.search(''))
  steps.sort_name = measure(() => list.sort('name', { order: 'asc' }))
  steps.sort_name_desc = measure(() => list.sort('name', { order: 'desc' }))
  steps.filter_city = measure(() => list.filter((item) => item.values().city === 'Salem'))
  steps.filter_none = measure(() => list.filter(() => true))
  steps.show_page = measure(() => list.show(1, 100))

  const result = {
    label: args.label,
    n: args.n,
    src: indexPath,
    initMs,
    initCounters: snapshotInit,
    finalDomChildren: listEl.childNodes.length,
    finalVisible: list.visibleItems.length,
    steps,
  }

  if (args.out) {
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true })
    fs.writeFileSync(args.out, JSON.stringify(result, null, 2))
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
}

main()
