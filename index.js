/*
 * Copyright (c) 2026 惠民惠爱电子商务有限公司
 * SPDX-License-Identifier: MIT
 */










'use strict'

const loginPage = require('./login-page')
const api = require('./api')
const health = require('./health')

const LOGIN_URL = 'https://mms.pinduoduo.com/login'
const HOME_URL = 'https://mms.pinduoduo.com/home'

const SUCCESS_TITLES = ['拼多多 商家后台', '首页', '订单查询']


const SYSTEM_TEXT = /客服不在线|用户已等待|请及时回复|正在查看商品|当前用户来自|将该会话转移|请先登录|会话已结束/
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'



const PDD_CODES = {
  0: 'text',
  1: 'image',
  14: 'video',
  2: 'video',
  3: 'product',
  4: 'product',
  64: 'product',
  24: 'system',
  30: 'system',
  40: 'system',
  43: 'system',
  5: 'emoji',
  1002: 'other'
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const trim = (s) => String(s == null ? '' : s).trim()

class PddAdapter {
  constructor(ctx) {
    this.ctx = ctx
    this.eb = ctx.browser
    this.busy = new Set()          
    this._busy = false             
    this._recentIds = new Set()    
  }

  
  _kindOf(raw, content) {
    const t = String(raw == null ? '' : raw).toLowerCase().trim()
    if (t && PDD_CODES[t]) return PDD_CODES[t]
    const s = String(content == null ? '' : content).trim()
    if (/^\[(图片|image|照片)(消息)?\]$/i.test(s)) return 'image'
    if (/^\[(视频|video|小视频)(消息)?\]$/i.test(s)) return 'video'
    if (/^\[(语音|voice|audio|录音)(消息)?\]$/i.test(s)) return 'voice'
    if (/^\[(表情|emoji|系统表情)(消息)?\]$/i.test(s)) return 'emoji'
    if (/^\[(商品|goods|product|卡片)(消息|卡片)?\]$/i.test(s)) return 'product'
    if (/^\[(系统|system)(消息)?\]$/i.test(s)) return 'system'
    return 'text'
  }

  

  
  async connect(opts = {}) {
    const wantSilent = !!opts.silent
    
    if (opts.addStore) return this._login({})
    
    if (opts.storeId) {
      const st = this.ctx.stores.byId(opts.storeId)
      if (!st) return { ok: false, message: '找不到这个店铺' }
      return this._login({ store: st, silent: wantSilent })
    }
    
    const saved = this.ctx.stores.byPlatform('pdd')
    if (saved.length) {
      let last = { ok: false, message: '没有可恢复的店铺' }
      for (const st of saved) {
        if (!st.account || !st.password) {
          last = { ok: false, message: `店铺「${st.store_name || st.id}」没有存账号密码，请点重连手动登录` }
          continue
        }
        last = await this._login({ store: st, silent: true })
        if (!last.ok) break
      }
      return last
    }
    
    return this._login({})
  }

  
  async _login(o = {}) {
    const eb = this.eb
    if (!eb) return { ok: false, message: '主窗口还没准备好，打不开登录页' }

    const store = o.store || null
    let account = store ? trim(store.account) : ''
    let password = store ? String(store.password || '') : ''

    
    if (!account || !password) {
      const r = await this.ctx.ui.loginForm({
        title: '🔐 登录拼多多店铺',
        hint: '这里是再登一家店铺：填要新登的拼多多商家后台账号密码，点「保存并登录」就会自动登录。\n'
          + '已登过的店铺掉线时不用来这里 —— 在店铺那一行点「重连」，会自动用存好的账号密码登回去。\n'
          + '如果拼多多要求验证码 / 短信，会自动把登录页面显示出来让你过一次。',
        submitLabel: '保存并登录',
        fields: [
          { key: 'account', label: '拼多多账号（登录手机号）', placeholder: '拼多多账号（登录手机号）' },
          { key: 'password', label: '登录密码', type: 'password', placeholder: '登录密码' }
        ]
      })
      if (!r) return { ok: false, cancelled: true, message: '已取消' }
      account = trim(r.values.account)
      password = String(r.values.password || '')
      
      
    }

    
    
    
    
    const session = this.ctx.login.begin({ key: store && store.view_key })
    if (session.alreadyRunning) return { ok: false, alreadyRunning: true, message: '上一次登录还没结束' }
    this._session = session
    const key = session.key
    this.busy.add(key)
    this._cancelled = false          

    const manual = !account || !password      
    const visible = !o.silent || manual
    try {
      if (o.fresh) {
        try {
          const n = await eb.clearCookiesForHosts(key, ['pinduoduo.com'])
          this.ctx.log('info', `重新登录拼多多：先清掉了 ${n} 条旧 cookie`)
        } catch (e) {  }
      }

      if (visible) this.ctx.ui.embedBar({ show: true, login: true, message: '正在打开拼多多登录页…' })
      
      await session.open(LOGIN_URL, { show: visible })
      if (visible) {
        this.ctx.ui.embedBar({ show: true, login: true, message: '正在用账号密码自动登录拼多多（不用你操作，登好会自动收起）' })
      }

      const page = this._pageOf(key)
      if (!page) throw new Error('登录页还没准备好')

      
      
      const pre = await this._waitLoggedIn(page, 10000)
      if (!pre.ok && manual) {
        
        try { eb.showModal(key, { width: 920, height: 640 }) } catch (e) {  }
        this.ctx.ui.embedBar({ show: true, login: true, message: '请在这个窗口里登录拼多多（扫码或账号密码都行），登好会自动收起' })
        this.ctx.log('info', '拼多多：手动登录模式，已把登录页显示出来等用户操作')
      } else if (!pre.ok) {
        this.ctx.log('info', '拼多多需要登录：切到「账号登录」并代填账号密码…')
        await loginPage.switchToAccountLogin(page)
        const report = await loginPage.autoFillInPage(page, account, password)
        if (/超时|timeout|Script failed/i.test(report)) {
          
          this.ctx.log('info', '拼多多代填脚本被页面跳转打断（正常），继续判断是否已登录')
        } else {
          this.ctx.log('info', '拼多多代填报告：' + report)
        }
      } else {
        this.ctx.log('info', '打开登录页后直接进了后台 —— 当前就是登录状态，本次不用重新登录')
      }

      
      const deadline = Date.now() + 150000
      let userShown = false
      let last = { ok: false }
      while (Date.now() < deadline) {
        
        
        if (this._cancelled) {
          this.ctx.log('info', '拼多多登录已被用户取消')
          session.abort('用户取消')
          this.ctx.ui.embedBar({ show: false })
          return { ok: false, cancelled: true, message: '已取消登录' }
        }
        last = await this._waitLoggedIn(page, 1000)
        if (last.ok) break
        if (await loginPage.loginPageNeedsUser(page)) {
          if (!userShown) {
            userShown = true
            try { eb.showModal(key, { width: 920, height: 640 }) } catch (e) {  }
            this.ctx.ui.embedBar({ show: true, login: true, message: '拼多多要验证一下（验证码 / 滑块），请在这个窗口里完成，登好会自动收起' })
            this.ctx.log('warn', '拼多多登录需要用户过验证码 / 滑块，已把登录页显示出来')
          }
        }
        await sleep(500)
      }
      if (!last.ok) return { ok: false, message: '登录没完成（超时）：' + (last.reason || '') }

      
      const cred = await this._extractCredentials(page, store)
      if (!cred.mallId) {
        this.ctx.log('warn', '拼多多登录成功，但没读到 mallId —— 店铺身份码会缺，稍后重连一次即可')
      }

      const saved = this.ctx.stores.upsert({
        platform: 'pdd',
        store_name: cred.name || ('拼多多店铺 ' + (cred.mallId || account)),
        account,
        password,                 
        identity_code: cred.mallId || '',
        avatar: cred.logo || '',
        cookies: cred.cookies,    
        anti_content: cred.antiContent || '',
        view_key: key,
        connected: true
      })

      this.ctx.log('success',
        `拼多多登录成功：${saved.store_name}（mallId ${cred.mallId || '?'}，cookie ${cred.cookies.length} 条）`)
      this._noteLogin(true)          

      
      await session.commit(saved)
      this.ctx.ui.embedBar({ show: false })

      return {
        ok: true,
        store: saved,
        store_name: saved.store_name,
        account,
        identity_code: saved.identity_code,
        avatar: saved.avatar
      }
    } catch (e) {
      this.ctx.log('error', '拼多多登录失败：' + (e && e.message))
      this._noteLogin(false)         
      
      
      
      
      if (!store) {
        try { await this.eb.clearCookiesForHosts(key, ['pinduoduo.com']) } catch (er) {  }
      }
      session.abort('登录失败')
      this.ctx.ui.embedBar({ show: false })
      return { ok: false, message: (e && e.message) || '登录失败' }
    } finally {
      this.busy.delete(key)
    }
  }

  
  _pageOf(key) {
    
    return this.ctx.page(key)
  }

  
  async _waitLoggedIn(page, timeoutMs) {
    const t0 = Date.now()
    let st = { title: '', url: '' }
    while (Date.now() - t0 < timeoutMs) {
      st = await loginPage.readLoginState(page)
      const titleOk = SUCCESS_TITLES.includes(trim(st.title))
      const urlOk = /mms\.pinduoduo\.com/.test(String(st.url || '')) && !/\/login/i.test(String(st.url || ''))
      if (titleOk || urlOk) return { ok: true, state: st }
      await sleep(500)
    }
    return { ok: false, state: st, reason: `标题「${trim(st.title)}」地址 ${String(st.url || '').slice(0, 60)}` }
  }

  
  async _extractCredentials(page, prevStore) {
    let cookies = []
    try { cookies = await page.context().cookies() } catch (e) {  }

    
    let mallId = ''
    try {
      const pass = cookies.find((c) => c && c.name === 'PASS_ID' && c.value)
      if (pass) {
        const m = String(pass.value).match(/_(\d{6,})_\d+$/)
        if (m) mallId = m[1]
      }
    } catch (e) {  }

    let antiContent = ''
    try {
      const ac = cookies.find((c) => c.name === 'anti_content' || c.name === 'anti-content')
      if (ac && ac.value) antiContent = ac.value
    } catch (e) {  }

    let name = ''
    let logo = ''
    let pageMall = ''
    try {
      const info = await page.evaluate(() => {
        const out = { mallId: '', name: '', logo: '', anti: '' }
        try { if (window.global_mall_id) out.mallId = String(window.global_mall_id) } catch (e) {  }
        try {
          const raw = localStorage.getItem('userinfo') || localStorage.getItem('new_userinfo') || ''
          const ui = JSON.parse(raw || '{}')
          const mall = ui.mall || {}
          if (!out.mallId && mall.mall_id) out.mallId = String(mall.mall_id)
          if (!out.mallId) {
            const ls = localStorage.getItem('currentMallId')
            if (ls) out.mallId = String(ls).replace(/"/g, '').trim()
          }
          if (mall.mall_name) out.name = String(mall.mall_name).trim()
          if (mall.logo) out.logo = String(mall.logo)
        } catch (e) {  }
        try {
          out.anti = localStorage.getItem('anti_content') || localStorage.getItem('anti-content') || ''
        } catch (e) {  }
        return out
      })
      if (info) {
        pageMall = String(info.mallId || '')
        name = trim(info.name)
        logo = trim(info.logo)
        if (!antiContent) antiContent = String(info.anti || '')
      }
    } catch (e) {  }
    if (!mallId) mallId = pageMall
    
    
    if (!antiContent) {
      antiContent = String((prevStore && prevStore.anti_content) || '')
      if (antiContent) this.ctx.log('info', '拼多多：这次没抓到新的 anti-content，沿用上一次的（' + antiContent.length + ' 字符）')
    }

    
    if ((!name || !logo) && mallId) {
      try {
        const headers = {
          'User-Agent': UA,
          'accept-language': 'zh-CN,zh;q=0.9',
          'content-type': 'application/json',
          'Referer': HOME_URL,
          'anti-content': antiContent || '',
          'cookie': cookies.map((c) => `${c.name}=${c.value}`).join('; ')
        }
        const res = await fetch('https://mms.pinduoduo.com/earth/api/merchant/queryMerchantInfoByMallId', {
          method: 'POST', headers, body: JSON.stringify({ mall_id: mallId }),
          signal: AbortSignal.timeout(15000)
        })
        const j = await res.json()
        if (j && j.success && j.result) {
          name = trim(j.result.mallName) || name
          logo = trim(j.result.mallLogo) || logo
        }
      } catch (e) {  }
    }

    return { cookies, mallId, antiContent, name, logo }
  }

  

  async cancel() {
    this._cancelled = true
    try { this.ctx.ui.embedBar({ show: false }) } catch (e) {  }
    
    try { if (this._session) this._session.abort('用户取消') } catch (e) {  }
    this.busy.clear()
  }

  
  async forget(store) {
    if (!store) return
    
    
    
    const key = store.view_key
    if (!key) return
    
    
    
    
    try { await this.eb.sessionFor(key).clearStorageData() } catch (e) {  }
    try { await this.eb.clearCookiesForHosts(key, ['pinduoduo.com']) } catch (e) {  }
    try { this.eb.close(key) } catch (e) {  }
  }

  
  async showBrowser(storeId) {
    const st = storeId ? this.ctx.stores.byId(storeId) : this.ctx.stores.byPlatform('pdd')[0]
    if (!st) return { ok: false }
    const key = st.view_key || 'pdd'
    if (!this.eb.has(key)) return { ok: false, message: '这家店还没登录过' }
    this.eb.show(key)
    return { ok: true }
  }

  

  
  startPolling(report) {
    if (this._timer) return
    const tick = () => {
      this._tick(report).catch((e) => this.ctx.log('warn', '拼多多轮询失败：' + e.message))
    }
    this._timer = setInterval(tick, 5000)
    setTimeout(tick, 1500)      
    
    for (const st of this.ctx.stores.byPlatform('pdd')) {
      this.ctx.log('info', `开始监听：${st.store_name || st.id}（每 5 秒轮询一次）`)
    }
    
    
    this._offlineTimer = setInterval(() => {
      for (const st of this.ctx.stores.byPlatform('pdd')) {
        if (st.connected) continue
        if (!(st.cookies || []).length && !st.password) continue
        this._recover(st).catch(() => {})
      }
    }, 120000)
  }

  stopPolling() {
    if (this._timer) { clearInterval(this._timer); this._timer = null }
    if (this._offlineTimer) { clearInterval(this._offlineTimer); this._offlineTimer = null }
  }

  async _tick(report) {
    
    
    
    
    if (this._busy) return
    this._busy = true
    try {
    const list = this.ctx.stores.byPlatform('pdd').filter((s) => s.connected && (s.cookies || []).length)
    for (const st of list) {
      try {
        const msgs = await this.poll(st)
        this._failCount = this._failCount || {}
        this._failCount[st.id] = 0
        this._markOnline(st, true)
        for (const m of msgs) {
          
          
          this.ctx.log('info', `轮询检测到客户消息：${String(m.content || '').slice(0, 40)}`,
            { customerUid: m.uid, shopId: this.ctx.stores.serverPkOf(st) })
          report(st, m)
        }
      } catch (e) {
        this.ctx.log('warn', `拼多多轮询失败（${st.store_name || st.id}）：` + (e && e.message),
          { shopId: this.ctx.stores.serverPkOf(st) })
        
        
        
        this._failCount = this._failCount || {}
        const n = (this._failCount[st.id] || 0) + 1
        this._failCount[st.id] = n
        if (n === 3) {
          this._markOnline(st, false)
          this.ctx.log('warn', `店铺「${st.store_name || st.id}」连续 3 次拉不到消息，判定离线，准备自动重登`,
            { shopId: this.ctx.stores.serverPkOf(st) })
        }
        const lastTry = this._lastRelogin && this._lastRelogin[st.id]
        this._lastRelogin = this._lastRelogin || {}
        if (n >= 3 && (!lastTry || Date.now() - lastTry > 120000)) {
          this._lastRelogin[st.id] = Date.now()
          this._recover(st).catch(() => {})
        }
      }
    }
    } finally {
      this._busy = false
    }
  }

  
  _markOnline(store, on) {
    if (!store || store.connected === on) return
    try {
      store.connected = on
      
      
      if (!this.ctx.stores.byId(store.id)) return
      if (typeof this.ctx.setStoreOnline === 'function') this.ctx.setStoreOnline(store, on)
      else this.ctx.stores.upsert({ id: store.id, platform: 'pdd', connected: on })
    } catch (e) {  }
  }

  
  async _recover(store) {
    const shopId = this.ctx.stores.serverPkOf(store)
    const key = store.view_key || 'pdd'
    const name = store.store_name || store.id

    
    try {
      const page = this._pageOf(key)
      const alive = await health.checkSessionAlive(page)
      if (alive.ok) {
        this._failCount[store.id] = 0
        this._markOnline(store, true)
        
        try {
          const cred = await this._extractCredentials(page, store)
          this.ctx.stores.upsert({
            id: store.id, platform: 'pdd', cookies: cred.cookies,
            anti_content: cred.antiContent || store.anti_content || ''
          })
        } catch (e) {  }
        this.ctx.log('success', `拼多多登录态已自动恢复（无需重新登录）：${name}`, { shopId })
        return true
      }
      this.ctx.log('info', `页面体检：${name} 被弹回登录页（${String(alive.url || '').slice(0, 60)}）`, { shopId })
    } catch (e) {
      this.ctx.log('warn', `页面体检失败：${name}（${e && e.message}）`, { shopId })
    }

    
    let failReason = ''
    if (store.account && store.password) {
      const r = await this._login({ store, silent: true })
      if (r && r.ok) {
        this._failCount[store.id] = 0
        this._markOnline(store, true)
        this.ctx.log('success', `自动重新登录成功：${name}`, { shopId })
        return true
      }
      failReason = (r && r.message) || '账号密码登录没成功'
    } else {
      failReason = '店铺里没存账号密码，没法自动登录'
    }

    
    this._markOnline(store, false)
    this.ctx.log('warn',
      `[需人工] 拼多多登录态失效，自动重新登录没成功（${failReason}），`
      + '需要你手动登录一次：点该店铺的「重连」，或点底部「登录店铺 → 拼多多」。',
      { shopId })
    return false
  }

  
  async poll(store) {
    const convs = await api.getConversations(store)
    const seen = this._seenOf(store)
    const out = []
    let changed = false
    for (const c of convs) {
      const prev = seen[c.uid]
      if (prev === undefined) {
        
        
        
        
        const atMs = c.lastAt ? Date.parse(c.lastAt) : 0
        const fresh2min = atMs && (Date.now() - atMs) < 120000
        if (!fresh2min && !(c.unread > 0)) {
          seen[c.uid] = c.lastMsgId
          changed = true
          continue
        }
        seen[c.uid] = c.lastMsgId
        changed = true
        if (c.lastDir === 'in' && !SYSTEM_TEXT.test(String(c.lastContent || ''))) {
          out.push({
            uid: c.uid, nickname: c.nickname, content: c.lastContent,
            msgType: c.lastType, msgId: c.lastMsgId, msgAt: c.lastAt, raw: c.raw
          })
        }
        continue
      }
      if (prev === c.lastMsgId) continue
      
      
      seen[c.uid] = c.lastMsgId
      changed = true
      
      
      let fresh = []
      try {
        const msgs = await api.getHistory(store, c.uid)
        const idx = msgs.findIndex((m) => m.msgId === prev)
        fresh = idx >= 0 ? msgs.slice(idx + 1) : msgs.slice(-1)
      } catch (e) {
        seen[c.uid] = prev               
        
        fresh = [{ msgId: c.lastMsgId, content: c.lastContent, type: c.lastType, at: c.lastAt, dir: c.lastDir, raw: c.raw }]
      }
      for (const m of fresh) {
        if (m.dir !== 'in') continue          
        if (SYSTEM_TEXT.test(String(m.content || ''))) continue   
        if (m.msgId && this._recentIds.has(m.msgId)) continue   
        if (m.msgId) {
          this._recentIds.add(m.msgId)
          if (this._recentIds.size > 500) {
            
            const first = this._recentIds.values().next().value
            this._recentIds.delete(first)
          }
        }
        out.push({
          uid: c.uid,
          nickname: c.nickname,
          content: m.content,
          msgType: m.type,
          msgId: m.msgId,
          msgAt: m.at,
          raw: m.raw
        })
      }
    }
    if (changed) this._saveSeen(store)
    return out
  }

  
  _seenOf(store) {
    const cfg = this._configDir()
    const file = require('node:path').join(cfg, 'seen.json')
    this._seenCache = this._seenCache || {}
    const key = String(store.id || store.identity_code || 'pdd')
    if (!this._seenCache[key]) {
      let all = {}
      try { all = JSON.parse(require('node:fs').readFileSync(file, 'utf8')) || {} } catch (e) {  }
      this._seenCache[key] = all[key] || {}
      this._seenFile = file
    }
    return this._seenCache[key]
  }

  _saveSeen(store) {
    try {
      const file = this._seenFile || require('node:path').join(this._configDir(), 'seen.json')
      let all = {}
      try { all = JSON.parse(require('node:fs').readFileSync(file, 'utf8')) || {} } catch (e) {  }
      all[String(store.id || store.identity_code || 'pdd')] = this._seenCache[String(store.id || store.identity_code || 'pdd')] || {}
      require('node:fs').mkdirSync(require('node:path').dirname(file), { recursive: true })
      require('node:fs').writeFileSync(file, JSON.stringify(all), 'utf8')
    } catch (e) {  }
  }

  _configDir() {
    const dir = this.ctx.config || ''
    try { require('node:fs').mkdirSync(dir, { recursive: true }) } catch (e) {  }
    return dir
  }

  
  
  
  
  
  _failFile() {
    return require('node:path').join(this._configDir(), 'login-failures.json')
  }

  _noteLogin(ok) {
    try {
      const f = this._failFile()
      let st = { fails: 0, gen: 2 }        
      try { st = { ...st, ...JSON.parse(require('node:fs').readFileSync(f, 'utf8')) } } catch (e) {  }
      if (ok) {
        if (st.fails || st.gen !== 2) {
          require('node:fs').writeFileSync(f, JSON.stringify({ fails: 0, gen: st.gen }), 'utf8')
        }
        return
      }
      st.fails = Number(st.fails || 0) + 1
      if (st.fails >= 3) {
        st.gen = Number(st.gen || 2) + 1
        st.fails = 0
        const name = 'persist:pdd-pdd-v' + st.gen
        if (typeof this.ctx.setPartition === 'function') this.ctx.setPartition(name)
        this.ctx.log('warn', `拼多多连续 3 次登录失败，已换一代浏览器分区：${name}（下次登录会用全新配置）`)
      }
      require('node:fs').writeFileSync(f, JSON.stringify(st), 'utf8')
    } catch (e) {  }
  }

  

  
  async send(conv, item) {
    const store = (conv && conv.shop) || this.ctx.stores.byPlatform('pdd')[0]
    if (!store) throw new Error('找不到这家店（还没登录）')
    const type = (item && item.type) || 'text'
    const content = String((item && item.content) || '').trim()
    if (!content) throw new Error('消息内容是空的')
    const uid = String(conv && conv.uid)
    if (!uid) throw new Error('缺少客户 id')

    if (type === 'text' || type === 'product_link' || type === 'spec_link') {
      return api.sendText(store, uid, content)
    }
    if (type === 'image') return api.sendImage(store, uid, content)
    if (type === 'video') return api.sendVideo(store, uid, content)
    throw new Error('拼多多不支持发送「' + type + '」')
  }

  
  
  
  
  
  
  
  
  async handleChatRequest(req) {
    const type = String((req && req.type) || '')
    const store = this._storeOf(req)
    if (!store) throw new Error('找不到这家店（还没登录）')

    
    
    if (type === 'product_list_sync' || type === 'product_detail') {
      throw new Error('商品列表功能已下线')
    }

    if (type === 'chat_get_conversations') return this._webConversations(store)
    if (type === 'chat_get_history') {
      const uid = String((req && (req.customer_uid || req.uid)) || '')
      if (!uid) throw new Error('缺少客户 id')
      return this._webHistory(store, uid)
    }
    throw new Error('拼多多暂不支持该请求类型：' + type)
  }

  
  _storeOf(req) {
    const pk = req && (req.shop_pk || req.shopId || req.shop_id)
    if (pk) {
      const st = this.ctx.stores.byServerPk(pk)
      if (st) return st
    }
    const list = this.ctx.stores.byPlatform('pdd')
    return list[0] || null
  }

  _keyOf(store) {
    return this.ctx.chatKey('pdd', store)
  }

  
  _productsFile(store) {
    return require('node:path').join(this._configDir(), 'products-' + String(store.identity_code || store.id || 'pdd') + '.json')
  }

  _readProducts(store) {
    try {
      const j = JSON.parse(require('node:fs').readFileSync(this._productsFile(store), 'utf8'))
      return Array.isArray(j && j.products) ? j.products : []
    } catch (e) {
      return []
    }
  }

  
  async _refreshProducts(store) {
    
    if (this._refreshing) return this._refreshing
    this._refreshing = (async () => {
      const products = await api.getAllProducts(store)
      try {
        const f = this._productsFile(store)
        require('node:fs').mkdirSync(require('node:path').dirname(f), { recursive: true })
        require('node:fs').writeFileSync(f, JSON.stringify({ at: new Date().toISOString(), products }), 'utf8')
      } catch (e) {  }
      this.ctx.log('info', `商品列表已同步：${products.length} 个`, { shopId: this.ctx.stores.serverPkOf(store) })
      return products
    })()
    try {
      return await this._refreshing
    } finally {
      this._refreshing = null
    }
  }

  async _webConversations(store) {
    try {
      const convs = await api.getConversations(store)
      
      for (const c of convs) {
        try {
          this.ctx.chat.append(this._keyOf(store), {
            uid: c.uid, name: c.nickname, dir: c.lastDir,
            
            type: this._kindOf(c.lastType, c.lastContent),
            text: c.lastContent, at: c.lastAt, mid: c.lastMsgId, raw: c.raw
          })
        } catch (e) {  }
      }
      return {
        conversations: convs.map((c) => ({
          customer_uid: c.uid,
          nickname: c.nickname,
          avatar: c.avatar,
          unread: c.unread,
          last_content: c.lastContent,
          last_msg_type: this._kindOf(c.lastType, c.lastContent),
          last_msg_id: c.lastMsgId,
          last_msg_at: c.lastAt,
          last_direction: c.lastDir,
          last_raw: c.raw
        })),
        cached: false
      }
    } catch (e) {
      const local = this.ctx.chat.conversations(this._keyOf(store)) || []
      if (!local.length) throw e
      this.ctx.log('warn', `在线聊天：这次没拉到实时会话（${e.message}）—— 改用本地记录（${local.length} 个会话）`)
      return {
        conversations: local.map((c) => ({
          customer_uid: c.customer_uid,
          nickname: c.nickname,
          unread: c.unread,
          last_content: c.last_content,
          last_msg_type: c.last_msg_type,
          last_msg_id: '',
          last_msg_at: c.last_msg_at,
          last_direction: c.last_direction
        })),
        cached: true,
        cachedAt: new Date().toISOString()
      }
    }
  }

  async _webHistory(store, uid) {
    const key = this._keyOf(store)
    try {
      const msgs = await api.getHistory(store, uid)
      
      try {
        this.ctx.chat.appendMany(key, msgs.map((m) => ({
          uid, dir: m.dir === 'system' ? 'system' : m.dir,
          type: this._kindOf(m.type, m.content),
          text: m.content, at: m.at, mid: m.msgId
        })), { imported: true })
      } catch (e) {  }
      
      try { this.ctx.chat.markRead(key, uid) } catch (e) {  }
      return {
        messages: msgs.map((m) => ({
          msg_id: m.msgId,
          direction: m.dir,
          isSystem: m.dir === 'system',
          msg_type: this._kindOf(m.type, m.content),
          content: m.content,
          msg_at: m.at,
          
          
          
          goods_id: (m.goods && m.goods.goods_id) || '',
          goods_name: (m.goods && m.goods.goods_name) || '',
          goods_price: (m.goods && m.goods.goods_price) != null ? m.goods.goods_price : null,
          goods_thumb: (m.goods && m.goods.goods_thumb) || '',
          goods_spec: (m.goods && m.goods.goods_spec) || '',
          goods_link: (m.goods && m.goods.goods_link) || ''
        })),
        cached: false
      }
    } catch (e) {
      const local = this.ctx.chat.history(key, uid) || []
      if (!local.length) throw e
      this.ctx.log('warn', `在线聊天：这次没拉到实时聊天记录（${e.message}）—— 改用本地记录（${local.length} 条）`)
      return {
        messages: local.map((m) => ({
          msg_id: m.mid || m.id || '',
          direction: m.dir,
          isSystem: m.dir === 'system',
          msg_type: m.type,
          content: m.text,
          msg_at: m.at,
          goods_id: (m.goods && m.goods.goods_id) || '',
          goods_name: (m.goods && m.goods.goods_name) || '',
          goods_price: (m.goods && m.goods.goods_price) != null ? m.goods.goods_price : null,
          goods_thumb: (m.goods && m.goods.goods_thumb) || '',
          goods_spec: (m.goods && m.goods.goods_spec) || ''
        })),
        cached: true,
        cachedAt: new Date().toISOString()
      }
    }
  }
}

module.exports = {
  key: 'pdd',
  name: '拼多多',
  
  partition: 'persist:pdd-pdd-v2',
  capabilities: { text: true, image: true, video: true, emoji: true },
  
  codeTable: PDD_CODES,
  create: (ctx) => new PddAdapter(ctx)
}
