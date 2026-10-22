/**
 * 生成逐臂归因用的变体工作树。
 *
 *   arms/A     只启用「增量 DOM 同步」（templater.sync + update 重写 + 去掉 search 里多余的 clear）
 *   arms/AB    追加「搜索小写缓存」
 *   arms/ABC   再追加「排序比较器前置化」== patched
 *
 * 每个变体只替换必要文件，其余与 upstream 逐字节一致，保证归因隔离。
 */
'use strict'

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const UP = path.join(ROOT, 'upstream', 'src')
const PA = path.join(ROOT, 'patched', 'src')
const ARMS = path.join(ROOT, 'arms')

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true })
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true })
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name)
    const d = path.join(dst, e.name)
    if (e.isDirectory()) copyDir(s, d)
    else fs.copyFileSync(s, d)
  }
}

/** 上游 search.js 去掉 prepare.resetList 里的 templater.clear()，其余保持原样 */
function searchWithoutClear() {
  const src = fs.readFileSync(path.join(UP, 'search.js'), 'utf8')
  const needle = '      list.templater.clear()\n'
  if (src.indexOf(needle) === -1) throw new Error('clear line not found in upstream search.js')
  return src.replace(needle, '')
}

function buildArm(name, files) {
  const dst = path.join(ARMS, name)
  rmrf(dst)
  copyDir(UP, path.join(dst, 'src'))
  for (const [rel, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dst, 'src', rel), content)
  }
  // 复用上游 package.json / jest 配置，只拷需要的
  for (const f of ['package.json', 'LICENSE', '.browserslistrc']) {
    fs.copyFileSync(path.join(ROOT, 'upstream', f), path.join(dst, f))
  }
  return dst
}

function main() {
  fs.mkdirSync(ARMS, { recursive: true })

  const patchedTemplater = fs.readFileSync(path.join(PA, 'templater.js'), 'utf8')
  const patchedIndex = fs.readFileSync(path.join(PA, 'index.js'), 'utf8')
  const patchedSearch = fs.readFileSync(path.join(PA, 'search.js'), 'utf8')
  const patchedSort = fs.readFileSync(path.join(PA, 'sort.js'), 'utf8')

  buildArm('A', {
    'templater.js': patchedTemplater,
    'index.js': patchedIndex,
    'search.js': searchWithoutClear(),
  })

  buildArm('AB', {
    'templater.js': patchedTemplater,
    'index.js': patchedIndex,
    'search.js': patchedSearch,
  })

  buildArm('ABC', {
    'templater.js': patchedTemplater,
    'index.js': patchedIndex,
    'search.js': patchedSearch,
    'sort.js': patchedSort,
  })

  // 自检：ABC 必须与 patched 的 src 逐字节一致
  for (const f of ['templater.js', 'index.js', 'search.js', 'sort.js']) {
    const a = fs.readFileSync(path.join(ARMS, 'ABC', 'src', f))
    const b = fs.readFileSync(path.join(PA, f))
    if (Buffer.compare(a, b) !== 0) throw new Error('ABC mismatch on ' + f)
  }
  process.stdout.write('arms built: A, AB, ABC (ABC == patched)\n')
}

main()
