var Templater = function (list) {
  var createItem,
    templater = this

  var init = function () {
    var itemSource

    if (typeof list.item === 'function') {
      createItem = function (values) {
        var item = list.item(values)
        return getItemSource(item)
      }
      return
    }

    if (typeof list.item === 'string') {
      if (list.item.indexOf('<') === -1) {
        itemSource = document.getElementById(list.item)
      } else {
        itemSource = getItemSource(list.item)
      }
    } else {
      /* If item source does not exists, use the first item in list as
      source for new items */
      itemSource = getFirstListItem()
    }

    if (!itemSource) {
      throw new Error("The list needs to have at least one item on init otherwise you'll have to add a template.")
    }

    itemSource = createCleanTemplateItem(itemSource, list.valueNames)

    createItem = function () {
      return itemSource.cloneNode(true)
    }
  }

  var createCleanTemplateItem = function (templateNode, valueNames) {
    var el = templateNode.cloneNode(true)
    el.removeAttribute('id')

    for (var i = 0, il = valueNames.length; i < il; i++) {
      var elm = undefined,
        valueName = valueNames[i]
      if (valueName.data) {
        for (var j = 0, jl = valueName.data.length; j < jl; j++) {
          el.setAttribute('data-' + valueName.data[j], '')
        }
      } else if (valueName.attr && valueName.name) {
        elm = list.utils.getByClass(el, valueName.name, true)
        if (elm) {
          elm.setAttribute(valueName.attr, '')
        }
      } else {
        elm = list.utils.getByClass(el, valueName, true)
        if (elm) {
          elm.innerHTML = ''
        }
      }
    }
    return el
  }

  var getFirstListItem = function () {
    var nodes = list.list.childNodes

    for (var i = 0, il = nodes.length; i < il; i++) {
      // Only textnodes have a data attribute
      if (nodes[i].data === undefined) {
        return nodes[i].cloneNode(true)
      }
    }
    return undefined
  }

  var getItemSource = function (itemHTML) {
    if (typeof itemHTML !== 'string') return undefined
    if (/<tr[\s>]/g.exec(itemHTML)) {
      var tbody = document.createElement('tbody')
      tbody.innerHTML = itemHTML
      return tbody.firstElementChild
    } else if (itemHTML.indexOf('<') !== -1) {
      var div = document.createElement('div')
      div.innerHTML = itemHTML
      return div.firstElementChild
    }
    return undefined
  }

  var getValueName = function (name) {
    for (var i = 0, il = list.valueNames.length; i < il; i++) {
      var valueName = list.valueNames[i]
      if (valueName.data) {
        var data = valueName.data
        for (var j = 0, jl = data.length; j < jl; j++) {
          if (data[j] === name) {
            return { data: name }
          }
        }
      } else if (valueName.attr && valueName.name && valueName.name == name) {
        return valueName
      } else if (valueName === name) {
        return name
      }
    }
  }

  var setValue = function (item, name, value) {
    var elm = undefined,
      valueName = getValueName(name)
    if (!valueName) return
    if (valueName.data) {
      item.elm.setAttribute('data-' + valueName.data, value)
    } else if (valueName.attr && valueName.name) {
      elm = list.utils.getByClass(item.elm, valueName.name, true)
      if (elm) {
        elm.setAttribute(valueName.attr, value)
      }
    } else {
      elm = list.utils.getByClass(item.elm, valueName, true)
      if (elm) {
        elm.innerHTML = value
      }
    }
  }

  this.get = function (item, valueNames) {
    templater.create(item)
    var values = {}
    for (var i = 0, il = valueNames.length; i < il; i++) {
      var elm = undefined,
        valueName = valueNames[i]
      if (valueName.data) {
        for (var j = 0, jl = valueName.data.length; j < jl; j++) {
          values[valueName.data[j]] = list.utils.getAttribute(item.elm, 'data-' + valueName.data[j])
        }
      } else if (valueName.attr && valueName.name) {
        elm = list.utils.getByClass(item.elm, valueName.name, true)
        values[valueName.name] = elm ? list.utils.getAttribute(elm, valueName.attr) : ''
      } else {
        elm = list.utils.getByClass(item.elm, valueName, true)
        values[valueName] = elm ? elm.innerHTML : ''
      }
    }
    return values
  }

  this.set = function (item, values) {
    if (!templater.create(item)) {
      for (var v in values) {
        if (values.hasOwnProperty(v)) {
          setValue(item, v, values[v])
        }
      }
    }
  }

  this.create = function (item) {
    if (item.elm !== undefined) {
      return false
    }
    item.elm = createItem(item.values())
    templater.set(item, item.values())
    return true
  }
  this.remove = function (item) {
    if (item.elm.parentNode === list.list) {
      list.list.removeChild(item.elm)
    }
  }
  this.show = function (item) {
    templater.create(item)
    list.list.appendChild(item.elm)
  }
  this.hide = function (item) {
    if (item.elm !== undefined && item.elm.parentNode === list.list) {
      list.list.removeChild(item.elm)
    }
  }

  /*
   * 增量同步容器子节点到目标顺序。
   *
   * 上游做法是「clear() 全量拆掉 + 逐个 appendChild 重新挂回」，可见集合与
   * 顺序都没变时同样会产生 2N 次 DOM 变更。这里改为三步：
   *   1. 确保目标项都有 DOM 节点（create 对已有 elm 是 no-op）；
   *   2. 给目标节点打本轮 token，单次遍历移除所有非目标子节点
   *      （包含非 item 节点，与原 clear() 的「清空容器」语义一致）；
   *   3. 单次前向扫描按序就位，仅对位置不对的节点调用 insertBefore。
   *
   * 不引入 Set / Map / WeakMap，保持 .browserslistrc 声明的 IE9 兼容。
   */
  var syncToken = 0

  this.sync = function (items) {
    var container = list.list,
      n = items.length,
      i,
      elm,
      node,
      nextNode,
      cursor

    if (n === 0) {
      templater.clear()
      return
    }

    for (i = 0; i < n; i++) {
      templater.create(items[i])
    }

    syncToken++
    for (i = 0; i < n; i++) {
      items[i].elm._listjsSyncToken = syncToken
    }

    node = container.firstChild
    while (node) {
      nextNode = node.nextSibling
      if (node._listjsSyncToken !== syncToken) {
        container.removeChild(node)
      }
      node = nextNode
    }

    cursor = container.firstChild
    for (i = 0; i < n; i++) {
      elm = items[i].elm
      if (elm === cursor) {
        cursor = cursor.nextSibling
      } else {
        container.insertBefore(elm, cursor)
      }
    }
  }
  this.clear = function () {
    /* .innerHTML = ''; fucks up IE */
    if (list.list.hasChildNodes()) {
      while (list.list.childNodes.length >= 1) {
        list.list.removeChild(list.list.firstChild)
      }
    }
  }

  init()
}

module.exports = function (list) {
  return new Templater(list)
}
