/**
 * DOM 变更预算测试。
 *
 * 这些断言测的不是「结果对不对」（那由既有用例保证），而是「为了得到正确
 * 结果，动了多少 DOM」。上游每次 update 都会 clear() 全量拆掉再逐个
 * appendChild 挂回，因此哪怕可见集合与顺序完全没变，也要付出 2N 次变更。
 *
 * 前三条在上游实现上必然失败，它们是「优化确实生效」的判据；后几条两臂都
 * 应通过，用来防止为了少动 DOM 而把语义改坏。
 */
const fixture = require('./fixtures')

const SIZE = 120

function makeList() {
  const items = []
  for (let i = 0; i < SIZE; i++) {
    items.push({ name: 'item' + i, born: String(1900 + i) })
  }
  return fixture.list(['name', 'born'], items)
}

function instrument(listEl) {
  const counts = { append: 0, remove: 0, insert: 0 }
  const proto = Node.prototype
  const origAppend = proto.appendChild
  const origRemove = proto.removeChild
  const origInsert = proto.insertBefore

  proto.appendChild = function (child) {
    if (this === listEl) counts.append++
    return origAppend.call(this, child)
  }
  proto.removeChild = function (child) {
    if (this === listEl) counts.remove++
    return origRemove.call(this, child)
  }
  proto.insertBefore = function (child, ref) {
    if (this === listEl) counts.insert++
    return origInsert.call(this, child, ref)
  }

  return {
    counts,
    total: () => counts.append + counts.remove + counts.insert,
    reset: () => {
      counts.append = 0
      counts.remove = 0
      counts.insert = 0
    },
    restore: () => {
      proto.appendChild = origAppend
      proto.removeChild = origRemove
      proto.insertBefore = origInsert
    },
  }
}

describe('DOM mutation budget', function () {
  let list, probe

  beforeEach(function () {
    list = makeList()
    probe = instrument(list.list)
  })

  afterEach(function () {
    probe.restore()
    fixture.removeList()
  })

  it('issues zero DOM mutations when a repeated search returns the same set', function () {
    list.search('item1')
    const settled = list.visibleItems.length
    expect(settled).toBeGreaterThan(0)

    probe.reset()
    list.search('item1')
    expect(list.visibleItems.length).toBe(settled)
    expect(probe.total()).toBe(0)
  })

  it('only removes the items that drop out when a search narrows', function () {
    list.search('item1')
    const before = list.visibleItems.length

    probe.reset()
    list.search('item12')
    const after = list.visibleItems.length

    expect(after).toBeLessThan(before)
    // 消失的才需要摘掉；留下的必须原地不动，不重建
    expect(probe.counts.remove).toBe(before - after)
    expect(probe.counts.append + probe.counts.insert).toBe(0)
  })

  it('only inserts the items that come back when a filter is reset', function () {
    list.filter(function (item) {
      return item.values().name.indexOf('item1') === 0
    })
    const filtered = list.visibleItems.length
    const total = list.items.length

    probe.reset()
    list.filter(function () {
      return true
    })

    expect(list.visibleItems.length).toBe(total)
    expect(probe.counts.remove).toBe(0)
    expect(probe.counts.append + probe.counts.insert).toBe(total - filtered)
  })

  it('keeps DOM order identical to visibleItems order after sorting', function () {
    list.sort('name', { order: 'desc' })
    const domOrder = []
    for (let n = list.list.firstChild; n; n = n.nextSibling) {
      domOrder.push(n.textContent)
    }
    const modelOrder = list.visibleItems.map(function (item) {
      return item.elm.textContent
    })
    expect(domOrder).toEqual(modelOrder)
    expect(domOrder.length).toBe(SIZE)
  })

  it('keeps DOM order identical after paging and back', function () {
    list.show(1, 10)
    expect(list.list.childNodes.length).toBe(10)
    const firstPage = []
    for (let n = list.list.firstChild; n; n = n.nextSibling) {
      firstPage.push(n.textContent)
    }
    expect(firstPage).toEqual(list.visibleItems.map((i) => i.elm.textContent))

    list.show(1, 10000)
    expect(list.list.childNodes.length).toBe(SIZE)
    const all = []
    for (let n = list.list.firstChild; n; n = n.nextSibling) {
      all.push(n.textContent)
    }
    expect(all).toEqual(list.visibleItems.map((i) => i.elm.textContent))
  })

  it('still drops non-item children from the container', function () {
    const junk = document.createElement('div')
    junk.className = 'junk'
    list.list.appendChild(junk)
    expect(list.list.contains(junk)).toBe(true)

    list.search('item12')
    expect(list.list.contains(junk)).toBe(false)
  })

  it('empties the container when nothing matches', function () {
    list.search('item1')
    expect(list.list.childNodes.length).toBeGreaterThan(0)

    list.search('no-such-token')
    expect(list.list.childNodes.length).toBe(0)
    expect(list.visibleItems.length).toBe(0)
  })

  it('sees values rewritten between two searches (lowercase cache must invalidate)', function () {
    list.search('item12')
    expect(list.visibleItems.length).toBe(1)

    list.items[0].values({ name: 'Brand New Token', born: '2000' })
    list.search('brand new')
    expect(list.visibleItems.length).toBe(1)
    expect(list.visibleItems[0]).toBe(list.items[0])

    // 改回原值，缓存命中旧条目时结果仍必须正确
    list.items[0].values({ name: 'item0', born: '1900' })
    list.search('item12')
    expect(list.visibleItems.length).toBe(1)
    expect(list.visibleItems[0].values().name).toBe('item12')
  })

  it('keeps add/remove in sync with the DOM', function () {
    list.add([{ name: 'zzz tail', born: '2099' }])
    expect(list.list.childNodes.length).toBe(SIZE + 1)
    const last = list.list.lastChild
    expect(last.textContent.indexOf('zzz tail')).toBeGreaterThan(-1)

    list.remove('name', 'zzz tail')
    expect(list.list.childNodes.length).toBe(SIZE)
  })
})
