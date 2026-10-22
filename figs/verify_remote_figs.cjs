/**
 * 图片上线第三关：用真实浏览器解码远端 PNG，确认 naturalWidth > 0。
 * 前两关（HTTP 200 + Markdown 引用数）过而路径错位时，这里会白屏。
 */
'use strict'

const { chromium } = require('playwright')

const BASE = 'https://raw.githubusercontent.com/linluozi/listjs-dom-sync/main/docs/figures/'
const FILES = ['fig1-dom-mutations.png', 'fig2-layout-iqr.png', 'fig3-attribution.png']

async function main() {
  const browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
    proxy: { server: 'http://127.0.0.1:7890' },
  })
  let bad = 0
  for (const f of FILES) {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    const url = BASE + f
    try {
      const resp = await page.goto(url, { waitUntil: 'load', timeout: 40000 })
      const info = await page.evaluate(() => {
        const img = document.querySelector('img')
        if (!img) return null
        return { w: img.naturalWidth, h: img.naturalHeight, complete: img.complete }
      })
      const status = resp ? resp.status() : 'no-response'
      const ok = info && info.complete && info.w > 0 && info.h > 0
      if (!ok) bad++
      console.log(
        (ok ? 'OK  ' : 'FAIL') + '  ' + f.padEnd(26) +
        ' http=' + status +
        ' natural=' + (info ? info.w + 'x' + info.h : 'null')
      )
    } catch (e) {
      bad++
      console.log('FAIL  ' + f + '  ' + e.message.split('\n')[0])
    }
    await ctx.close()
  }
  await browser.close()
  console.log(bad === 0 ? '\nall figures decode in a real browser' : '\n' + bad + ' figure(s) failed')
  process.exit(bad === 0 ? 0 : 1)
}

main()
