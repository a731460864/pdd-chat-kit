/*
 * Copyright (c) 2026 惠民惠爱电子商务有限公司
 * SPDX-License-Identifier: MIT
 */









'use strict'


async function clickByText(page, want) {
  try {
    return await page.evaluate((w) => {
      const vis = (e) => { const r = e.getBoundingClientRect(); return r.width >= 4 && r.height >= 4 }
      const textOf = (e) => String(e.innerText || '').trim()
      const all = Array.from(document.querySelectorAll('button,div,span,a,li,[role=button]')).filter(vis)
      
      let list = all.filter((e) => textOf(e) === w)
      if (!list.length) list = all.filter((e) => {
        const t = textOf(e)
        if (t.indexOf(w) < 0) return false
        
        if (w === '登录' && /扫码登录|账号登录/.test(t)) return false
        return t.length <= w.length + 4
      })
      if (!list.length) return null
      const el = list.sort((a, b) => a.getElementsByTagName('*').length - b.getElementsByTagName('*').length)[0]
      try { el.scrollIntoView({ block: 'center' }) } catch (e) {  }
      const desc = el.tagName + '.' + String(el.className || '').slice(0, 40) + '|' + textOf(el).slice(0, 20)
      try { el.click() } catch (e) { return 'ERR:' + e.message }
      return desc
    }, want)
  } catch (e) {
    return null
  }
}


async function switchToAccountLogin(page) {
  const hasPwd = async () => {
    try {
      return await page.evaluate(() => Array.from(document.querySelectorAll("input[type='password']"))
        .some((el) => { const r = el.getBoundingClientRect(); return r.width >= 4 && r.height >= 4 }))
    } catch (e) { return false }
  }
  if (await hasPwd()) return true

  const TAB_SEL = "div.Common_item__3diIn:has-text('账号登录')"
  for (let round = 1; round <= 3; round += 1) {
    
    
    try { await page.domClick(TAB_SEL) } catch (e) {  }
    await page.waitForTimeout(800)
    if (await hasPwd()) return true
    
    if (await clickByText(page, '账号登录')) {
      await page.waitForTimeout(1000)
      if (await hasPwd()) return true
    }
    
    try { await page.click(TAB_SEL, { noThrow: true }) } catch (e) {  }
    await page.waitForTimeout(600)
    if (await hasPwd()) return true
  }
  return await hasPwd()
}


async function autoFillInPage(page, account, password) {
  const script = `(async () => {
    const ACCOUNT = ${JSON.stringify(String(account))}
    const PASSWORD = ${JSON.stringify(String(password))}
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const vis = (e) => { try { const r = e.getBoundingClientRect(); return r.width >= 4 && r.height >= 4 } catch (err) { return false } }
    const txt = (e) => String(e.innerText || e.textContent || '').trim()
    const clickables = () => Array.from(document.querySelectorAll('button,div,span,a,li,[role=button]')).filter(vis)
    const byText = (t) => clickables().filter((e) => txt(e) === t)
    const pickInput = (sel) => Array.from(document.querySelectorAll(sel)).filter(vis)[0] || null
    const log = []
    // ① 切「账号登录」页签（最多等 6 秒）
    let tab = null
    for (let i = 0; i < 20 && !tab; i += 1) { tab = byText('账号登录')[0] || null; if (!tab) await sleep(300) }
    if (tab) { try { tab.click(); log.push('tab=clicked') } catch (e) { log.push('tab=err') } }
    else { log.push('tab=not-found') }
    // ② 等可见的账号 + 密码输入框（最多 12 秒；隐藏表单不算）
    let user = null
    let pwd = null
    for (let i = 0; i < 40; i += 1) {
      user = pickInput("input[type='text'],input[type='tel'],input:not([type])")
      pwd = pickInput("input[type='password']")
      if (user && pwd) break
      await sleep(300)
    }
    log.push('inputs=' + (user ? 'account' : 'none') + '+' + (pwd ? 'password' : 'none'))
    if (!user || !pwd) return log.join(' | ')
    // ③ 填值：原生 value setter + input/change（React 认这一套）
    const setValue = (el, v) => {
      try { el.scrollIntoView({ block: 'center' }) } catch (e) { /* ignore */ }
      try { el.click() } catch (e) { /* ignore */ }
      try { el.focus() } catch (e) { /* ignore */ }
      try { el.setSelectionRange(0, String(el.value || '').length) } catch (e) { /* ignore */ }
      try {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        setter.call(el, v)
      } catch (e) { el.value = v }
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return String(el.value || '').length
    }
    log.push('account-len=' + setValue(user, ACCOUNT))
    log.push('password-len=' + setValue(pwd, PASSWORD))
    // ④ 点「登录」（挑可见、文字正好是「登录」的按钮；两个页签不算）
    const btn = byText('登录').filter((e) => !/扫码登录|账号登录/.test(txt(e)))[0] || null
    if (btn) { try { btn.click(); log.push('login-btn=clicked') } catch (e) { log.push('login-btn=err') } }
    else { log.push('login-btn=not-found') }
    // ⚠️ 点完「登录」页面会立刻开始跳转 —— 这里**不能**再等 / 再读东西，
    //    否则整个脚本会被导航打断（外面看到的就是"页面执行超时"）。
    //    登录成没成功由外面的轮询判断，不靠这个脚本回报。
    return log.join(' | ')
  })()`
  try {
    return String(await page.evaluate(script))
  } catch (e) {
    return 'fill-script-error: ' + String((e && e.message) || e)
  }
}


async function readLoginState(page) {
  try {
    const st = await page.evaluate(() => {
      const text = String((document.body && document.body.innerText) || '').slice(0, 3000)
      let hint = ''
      try {
        const el = document.querySelector(
          "[class*='error'],[class*='Error'],[class*='tip'],[class*='Tip'],[class*='warn'],[class*='Warning']")
        hint = String((el && el.innerText) || '').replace(/\s+/g, ' ').trim().slice(0, 60)
      } catch (e) {  }
      return {
        title: String(document.title || ''),
        url: String(location.href),
        hint,
        text: text.replace(/\s+/g, ' ')
      }
    })
    if (st && (st.url || st.title)) return st
  } catch (e) {  }
  try {
    return { title: '', url: String(page.url() || ''), hint: '', text: '' }
  } catch (e) {
    return { title: '', url: '', hint: '', text: '' }
  }
}


async function loginPageNeedsUser(page) {
  try {
    return await page.evaluate(() => {
      const text = String((document.body && document.body.innerText) || '').slice(0, 6000)
      if (/请完成验证|拖动滑块|拖动下方滑块|安全验证|请完成安全验证|短信验证码/.test(text)) return true
      if (document.querySelector('iframe[src*="captcha"], iframe[src*="verify"], iframe[src*="nocaptcha"]')) return true
      if (document.querySelector("[id*='nc_1'],[class*='nc_1'],[class*='nc-container'],[class*='verifyBar']")) return true
      return false
    })
  } catch (e) {
    return false
  }
}

module.exports = { clickByText, switchToAccountLogin, autoFillInPage, readLoginState, loginPageNeedsUser }
