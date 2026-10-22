module.exports = function (list) {
  var buttons = {
    els: undefined,
    clear: function () {
      for (var i = 0, il = buttons.els.length; i < il; i++) {
        list.utils.classes(buttons.els[i]).remove('asc')
        list.utils.classes(buttons.els[i]).remove('desc')
      }
    },
    getOrder: function (btn) {
      var predefinedOrder = list.utils.getAttribute(btn, 'data-order')
      if (predefinedOrder == 'asc' || predefinedOrder == 'desc') {
        return predefinedOrder
      } else if (list.utils.classes(btn).has('desc')) {
        return 'asc'
      } else if (list.utils.classes(btn).has('asc')) {
        return 'desc'
      } else {
        return 'asc'
      }
    },
    getInSensitive: function (btn, options) {
      var insensitive = list.utils.getAttribute(btn, 'data-insensitive')
      if (insensitive === 'false') {
        options.insensitive = false
      } else {
        options.insensitive = true
      }
    },
    setOrder: function (options) {
      for (var i = 0, il = buttons.els.length; i < il; i++) {
        var btn = buttons.els[i]
        if (list.utils.getAttribute(btn, 'data-sort') !== options.valueName) {
          continue
        }
        var predefinedOrder = list.utils.getAttribute(btn, 'data-order')
        if (predefinedOrder == 'asc' || predefinedOrder == 'desc') {
          if (predefinedOrder == options.order) {
            list.utils.classes(btn).add(options.order)
          }
        } else {
          list.utils.classes(btn).add(options.order)
        }
      }
    },
  }

  var sort = function () {
    list.trigger('sortStart')
    var options = {}

    var target = arguments[0].currentTarget || arguments[0].srcElement || undefined

    if (target) {
      options.valueName = list.utils.getAttribute(target, 'data-sort')
      buttons.getInSensitive(target, options)
      options.order = buttons.getOrder(target)
    } else {
      options = arguments[1] || options
      options.valueName = arguments[0]
      options.order = options.order || 'asc'
      options.insensitive = typeof options.insensitive == 'undefined' ? true : options.insensitive
    }

    buttons.clear()
    buttons.setOrder(options)

    // caseInsensitive
    // alphabet
    var customSortFunction = options.sortFunction || list.sortFunction || null,
      multi = options.order === 'desc' ? -1 : 1,
      sortFunction

    if (customSortFunction) {
      sortFunction = function (itemA, itemB) {
        return customSortFunction(itemA, itemB, options) * multi
      }
    } else {
      /*
       * 上游把 naturalSort 的选取、alphabet 赋值和 insensitive 判断全部放在
       * 比较器内部，于是 n·log n 次比较就要把这些重复执行 n·log n 遍。
       * 其中 `naturalSort.alphabet = ...` 是带 setter 的赋值，每次都会重建
       * 整张 alphabetIndexMap；配置了自定义 alphabet 时，一次排序会在比较器
       * 里重建上千次索引表。这里把三件事提到排序循环外，整轮只做一次。
       *
       * 未做「预提取排序键 + 预小写」：实测在 2000 行规模下端到端无可测收益
       * （见 README 的 sorting 一行），按最小改动原则不引入额外状态。
       */
      var naturalSort = list.utils.naturalSort,
        valueName = options.valueName

      naturalSort.alphabet = list.alphabet || options.alphabet || undefined

      if (!naturalSort.alphabet && options.insensitive) {
        sortFunction = function (itemA, itemB) {
          return naturalSort.caseInsensitive(itemA.values()[valueName], itemB.values()[valueName]) * multi
        }
      } else {
        sortFunction = function (itemA, itemB) {
          return naturalSort(itemA.values()[valueName], itemB.values()[valueName]) * multi
        }
      }
    }

    list.items.sort(sortFunction)
    list.update()
    list.trigger('sortComplete')
  }

  // Add handlers
  list.handlers.sortStart = list.handlers.sortStart || []
  list.handlers.sortComplete = list.handlers.sortComplete || []

  buttons.els = list.utils.getByClass(list.listContainer, list.sortClass)
  list.utils.events.bind(buttons.els, 'click', sort)
  list.on('searchStart', buttons.clear)
  list.on('filterStart', buttons.clear)

  return sort
}
