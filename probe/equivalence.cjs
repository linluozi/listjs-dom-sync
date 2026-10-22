/**
 * 差分等价性快照：对同一组 API 操作序列，记录每一步之后的
 *   - 容器 DOM 序列（逐节点 outerHTML）
 *   - visibleItems / matchingItems 的值序列
 *   - 每个 item 的 found / filtered 标志
 *   - toJSON() 结果
 * 两臂快照必须逐字节相同。
 *
 * 用法：node equivalence.cjs --src <dir> --out <file>
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { JSDOM } = require('jsdom')

function parseArgs(argv) {
  const out = { n: 200, src: null, out: null }
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i]
    if (k === '--n') out.n = parseInt(argv[++i], 10)
    else if (k === '--src') out.src = argv[++i]
    else if (k === '--out') out.out = argv[++i]
  }
  return out
}

const FIRST = ['Ava', 'Liam', 'Noah', 'Emma', 'Olivia', 'Mason', 'Sophia', 'Lucas', 'Mia', 'Ethan']
const LAST = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez']
const CITY = ['Springfield', 'Riverside', 'Franklin', 'Greenville', 'Clinton', 'Fairview', 'Salem', 'Madison', 'Georgetown', 'Arlington']

function buildRows(n) {
  const rows = []
  for (let i = 0; i < n; i++) {
    rows.push(
      '<li class="item"><span class="name">' + FIRST[i % 10] + ' ' + LAST[(i * 7) % 10] + '</span>' +
      '<span class="city">' + CITY[(i * 3) % 10] + '</span>' +
      '<span class="age">' + (18 + (i % 60)) + '</span></li>'
    )
  }
  return rows.join('')
}

function buildHtml(n) {
  return (
    '<!doctype html><html><body><div id="users">' +
    '<input class="search" /><input class="fuzzy-search" />' +
    '<span class="sort" data-sort="name"></span><span class="sort" data-sort="age"></span>' +
    '<ul class="list">' + buildRows(n) + '</ul></div></body></html>'
  )
}

function main() {
  const args = parseArgs(process.argv)
  const dom = new JSDOM(buildHtml(args.n), { url: 'http://localhost/' })
  const win = dom.window
  global.window = win
  global.document = win.document
  global.Node = win.Node
  global.Element = win.Element

  const List = require(path.join(path.resolve(args.src), 'src', 'index.js'))
  const listEl = win.document.querySelector('#users .list')

  const list = new List('users', {
    valueNames: ['name', 'city', 'age'],
    item: '<li class="item"><span class="name"></span><span class="city"></span><span class="age"></span></li>',
    fuzzySearch: { searchClass: 'fuzzy-search' },
  })

  const snap = () => {
    const domSeq = []
    for (let n = listEl.firstChild; n; n = n.nextSibling) {
      domSeq.push(n.nodeType === 1 ? n.outerHTML : '[text]' + n.nodeValue)
    }
    const vals = (arr) => arr.map((it) => [it.values().name, it.values().city, it.values().age])
    return {
      dom: domSeq,
      domCount: listEl.childNodes.length,
      visible: vals(list.visibleItems),
      matching: vals(list.matchingItems),
      found: list.items.map((it) => (it.found ? 1 : 0)),
      filtered: list.items.map((it) => (it.filtered ? 1 : 0)),
      json: list.toJSON(),
    }
  }

  const steps = []
  const record = (name) => steps.push({ name, state: snap() })

  record('init')

  list.search('a'); record('search:a')
  list.search('an'); record('search:an')
  list.search('ann'); record('search:ann')
  list.search('an'); record('search:an-again')
  list.search(''); record('search:reset')

  list.filter((i) => i.values().city === 'Salem'); record('filter:salem')
  list.filter((i) => i.values().city === 'Salem'); record('filter:salem-again')
  list.filter(() => true); record('filter:reset')

  list.sort('name', { order: 'asc' }); record('sort:name-asc')
  list.sort('name', { order: 'desc' }); record('sort:name-desc')
  list.sort('age', { order: 'asc' }); record('sort:age-asc')
  list.sort('age', { order: 'desc', insensitive: false }); record('sort:age-desc-sensitive')

  list.show(1, 20); record('show:page1of20')
  list.show(21, 20); record('show:page2of20')
  list.show(1, 10000); record('show:all')

  list.add([{ name: 'Zed Zulu', city: 'Nowhere', age: 7 }]); record('add')
  list.search('zed'); record('search:after-add')
  list.search(''); record('search:reset2')
  list.remove('name', 'Zed Zulu'); record('remove')

  // 值被原地改写后缓存必须失效
  list.items[0].values({ name: 'Qqqq Unique', city: 'Zzz', age: 3 }); record('values:mutate')
  list.search('qqqq'); record('search:after-mutate')
  list.search(''); record('search:reset3')
  // 改回原值，缓存若命中旧条目也必须给出正确结果
  list.items[0].values({ name: 'Ava Smith', city: 'Springfield', age: 18 }); record('values:mutate-back')
  list.search('ava'); record('search:after-mutate-back')
  list.search(''); record('search:reset4')

  list.fuzzySearch('mrtnz'); record('fuzzy:mrtnz')
  list.search(''); record('search:reset5')

  list.reIndex(); record('reIndex')

  // alphabet 自定义排序（会走 sort.js 的 else 分支）
  const alphaList = new List('users', {
    valueNames: ['name', 'city', 'age'],
    item: '<li class="item"><span class="name"></span><span class="city"></span><span class="age"></span></li>',
    alphabet: 'zyxwvutsrqponmlkjihgfedcba ZYXWVUTSRQPONMLKJIHGFEDCBA',
  })
  alphaList.sort('name', { order: 'asc' }); record('alphabet:sort-asc')
  alphaList.sort('name', { order: 'desc' }); record('alphabet:sort-desc')

  // 自定义 sortFunction 分支
  const customList = new List('users', {
    valueNames: ['name', 'city', 'age'],
    item: '<li class="item"><span class="name"></span><span class="city"></span><span class="age"></span></li>',
    sortFunction: (a, b) => (a.values().age - b.values().age) * 1,
  })
  customList.sort('age', { order: 'asc' }); record('custom-sort:age-asc')

  const payload = { n: args.n, steps }
  if (args.out) {
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true })
    fs.writeFileSync(args.out, JSON.stringify(payload))
  }
  process.stdout.write(JSON.stringify({ steps: steps.length, bytes: JSON.stringify(payload).length }) + '\n')
}

main()
