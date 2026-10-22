module.exports = function (list) {
  var item, text, columns, searchString, customSearch

  /*
   * 小写化缓存。
   *
   * 上游对每一轮搜索的每个 item × 每一列都重新 toLowerCase() 一遍，而 item
   * 的值在两次按键之间通常没有任何变化。这里按 (item, 列名) 缓存结果，并用
   * 缓存时的原文做严格相等校验：只要 item 的值被改写（values(newValues)），
   * 原文引用/内容必然不同，缓存自动失效，不需要显式失效钩子。
   *
   * 不引入 WeakMap（IE9 兼容）；缓存挂在 item 上，随 item 一起被回收。
   * 键加 '$' 前缀，避免 __proto__ / constructor 之类的列名污染原型链。
   */
  var lowerOf = function (item, column, text) {
    var cache = item._listjsLower,
      entry
    if (cache === undefined) {
      cache = item._listjsLower = {}
    }
    entry = cache['$' + column]
    if (entry !== undefined && entry.text === text) {
      return entry.lower
    }
    entry = { text: text, lower: text.toLowerCase() }
    cache['$' + column] = entry
    return entry.lower
  }

  var prepare = {
    resetList: function () {
      list.i = 1
      customSearch = undefined
    },
    setOptions: function (args) {
      if (args.length == 2 && args[1] instanceof Array) {
        columns = args[1]
      } else if (args.length == 2 && typeof args[1] == 'function') {
        columns = undefined
        customSearch = args[1]
      } else if (args.length == 3) {
        columns = args[1]
        customSearch = args[2]
      } else {
        columns = undefined
      }
    },
    setColumns: function () {
      if (list.items.length === 0) return
      if (columns === undefined) {
        columns = list.searchColumns === undefined ? prepare.toArray(list.items[0].values()) : list.searchColumns
      }
    },
    setSearchString: function (s) {
      s = list.utils.toString(s).toLowerCase()
      s = s.replace(/[-[\]{}()*+?.,\\^$|#]/g, '\\$&') // Escape regular expression characters
      searchString = s
    },
    toArray: function (values) {
      var tmpColumn = []
      for (var name in values) {
        tmpColumn.push(name)
      }
      return tmpColumn
    },
  }
  var search = {
    list: function () {
      // Extract quoted phrases "word1 word2" from original searchString
      // searchString is converted to lowercase by List.js
      var words = [],
        phrase,
        ss = searchString
      while ((phrase = ss.match(/"([^"]+)"/)) !== null) {
        words.push(phrase[1])
        ss = ss.substring(0, phrase.index) + ss.substring(phrase.index + phrase[0].length)
      }
      // Get remaining space-separated words (if any)
      ss = ss.trim()
      if (ss.length) words = words.concat(ss.split(/\s+/))
      for (var k = 0, kl = list.items.length; k < kl; k++) {
        var item = list.items[k]
        item.found = false
        if (!words.length) continue
        // values() 返回的是同一个 _values 引用，提到列循环外只取一次。
        var values = item.values()
        for (var i = 0, il = words.length; i < il; i++) {
          var word_found = false
          for (var j = 0, jl = columns.length; j < jl; j++) {
            var column = columns[j]
            if (values.hasOwnProperty(column) && values[column] !== undefined && values[column] !== null) {
              var text = typeof values[column] !== 'string' ? values[column].toString() : values[column]
              if (lowerOf(item, column, text).indexOf(words[i]) !== -1) {
                // word found, so no need to check it against any other columns
                word_found = true
                break
              }
            }
          }
          // this word not found? no need to check any other words, the item cannot match
          if (!word_found) break
        }
        item.found = word_found
      }
    },
    // Removed search.item() and search.values()
    reset: function () {
      list.reset.search()
      list.searched = false
    },
  }

  var searchMethod = function (str) {
    list.trigger('searchStart')

    prepare.resetList()
    prepare.setSearchString(str)
    prepare.setOptions(arguments) // str, cols|searchFunction, searchFunction
    prepare.setColumns()

    if (searchString === '') {
      search.reset()
    } else {
      list.searched = true
      if (customSearch) {
        customSearch(searchString, columns)
      } else {
        search.list()
      }
    }

    list.update()
    list.trigger('searchComplete')
    return list.visibleItems
  }

  list.handlers.searchStart = list.handlers.searchStart || []
  list.handlers.searchComplete = list.handlers.searchComplete || []

  list.utils.events.bind(
    list.utils.getByClass(list.listContainer, list.searchClass),
    'keyup',
    list.utils.events.debounce(function (e) {
      var target = e.target || e.srcElement, // IE have srcElement
        alreadyCleared = target.value === '' && !list.searched
      if (!alreadyCleared) {
        // If oninput already have resetted the list, do nothing
        searchMethod(target.value)
      }
    }, list.searchDelay)
  )

  // Used to detect click on HTML5 clear button
  list.utils.events.bind(list.utils.getByClass(list.listContainer, list.searchClass), 'input', function (e) {
    var target = e.target || e.srcElement
    if (target.value === '') {
      searchMethod('')
    }
  })

  return searchMethod
}
