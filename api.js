/*
 * Copyright (c) 2026 惠民惠爱电子商务有限公司
 * SPDX-License-Identifier: MIT
 */






'use strict'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'
const BASE = 'https://mms.pinduoduo.com'

const SESSION_EXPIRED = '会话已过期（拼多多登录态失效，请点店铺那一行的「重连」）'


const ERR_CN = {
  '43001': SESSION_EXPIRED,
  '40001': '参数不对（消息内容为空或格式不支持）',
  '54001': '被平台限制了（可能触发风控），请稍后再试'
}

function errorCn(reason) {
  const s = String(reason == null ? '' : reason).trim()
  if (!s) return '平台没有说明原因'
  return ERR_CN[s.toLowerCase()] || s
}

function requestId() {
  return Date.now() + '-' + Math.random().toString(36).slice(2, 11)
}


function headers(store) {
  const cookies = (store && store.cookies) || []
  const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
  return {
    'User-Agent': UA,
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Content-Type': 'application/json;charset=UTF-8',
    'Accept': 'application/json, text/plain, */*',
    'anti-content': (store && store.anti_content) || '',
    'Origin': BASE,
    'Referer': BASE + '/chat-merchant/index.html',
    'Cookie': cookieStr
  }
}

async function post(store, path, body, timeoutMs = 15000, referer) {
  const h = headers(store)
  
  
  if (referer) h.Referer = referer
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: h,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch (e) {  }
  if (!json) throw new Error('拼多多接口返回异常（HTTP ' + res.status + '）')
  return json
}




async function getConversations(store) {
  const r = await post(store, '/plateau/chat/latest_conversations', {
    data: {
      cmd: 'latest_conversations',
      request_id: requestId(),
      version: 2,
      need_unreply_time: true,
      page: 1,
      size: 100,
      anti_content: (store && store.anti_content) || ''
    },
    client: 1
  })
  if (!r || !r.success) throw new Error(errorCn(r && (r.error_msg || r.error_code)))
  const inner = (r && r.result) || {}
  return (inner.conversations || []).map((raw) => {
    const userInfo = raw.user_info || {}
    const ctx = raw.context || {}
    const from = raw.from
    const dir = from && typeof from === 'object' && from.role === 'mall_cs' ? 'out' : 'in'
    let uid = ''
    for (const k of ['from', 'to']) {
      const p = raw[k] || {}
      if (p.role === 'user' && p.uid) { uid = String(p.uid); break }
    }
    if (!uid && userInfo.uid) uid = String(userInfo.uid)
    return {
      uid,
      nickname: userInfo.nickname || '',
      avatar: userInfo.avatar || '',
      unread: parseInt(ctx.unread, 10) || 0,
      lastContent: typeof raw.content === 'string' ? raw.content : '[结构化消息]',
      lastType: (raw.type === undefined || raw.type === null || raw.type === '') ? 'text' : String(raw.type),
      lastMsgId: raw.msg_id || '',
      lastAt: raw.ts ? new Date(Number(raw.ts) * 1000).toISOString() : null,
      lastDir: dir,
      raw
    }
  }).filter((c) => c.uid)
}


async function getHistory(store, uid, size = 50) {
  const r = await post(store, '/plateau/chat/list', {
    data: {
      cmd: 'list',
      request_id: Date.now(),
      list: { with: { role: 'user', id: String(uid) }, start_msg_id: null, start_index: 0, size },
      notUpdateUnreplyTs: true,
      anti_content: (store && store.anti_content) || ''
    }
  })
  if (!r || !r.success) throw new Error(errorCn(r && (r.error_msg || r.error_code)))
  const msgs = ((r.result || {}).messages) || []
  return msgs.map((m) => {
    const role = (m.from && m.from.role) || ''
    const isSystem = role !== 'user' && role !== 'mall_cs'
    return {
      msgId: m.msg_id || '',
      uid: String(uid),
      type: m.type,
      content: typeof m.content === 'string' ? m.content : '',
      dir: isSystem ? 'system' : (role === 'mall_cs' ? 'out' : 'in'),
      at: m.ts ? new Date(Number(m.ts) * 1000).toISOString() : null,
      goods: goodsOf(m),
      raw: m
    }
  }).sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')))
}


function goodsOf(m) {
  const out = { goods_id: '', goods_name: '', goods_price: null, goods_thumb: '', goods_spec: '', goods_link: '' }
  try {
    if (!m || typeof m !== 'object') return null
    const layers = []
    const pushLayer = (x) => { if (x && typeof x === 'object' && !Array.isArray(x)) layers.push(x) }
    for (const info of [m.message && m.message.info, m.info]) {
      pushLayer(info)
      if (info && typeof info === 'object') {
        pushLayer(info.data)
        pushLayer(info.goods_info)
      }
    }
    const ctx = m.context
    if (ctx && typeof ctx === 'object') pushLayer(ctx.n_context)
    pushLayer(m.biz_context)

    const pick = (...keys) => {
      for (const L of layers) {
        for (const k of keys) {
          const v = L[k]
          if (v === undefined || v === null) continue
          const s = String(v).trim()
          if (s) return s
        }
      }
      return ''
    }
    const num = (s) => { const n = Number(s); return isNaN(n) ? null : n }

    out.goods_id = pick('goods_id', 'goodsID', 'goodsId')
    out.goods_name = pick('goods_name', 'goodsName', 'name')
    out.goods_thumb = pick('thumb_url', 'goods_thumb_url', 'goodsThumbUrl')
    out.goods_spec = pick('goods_spec', 'spec')
    out.goods_link = pick('link_url', 'linkUrl', 'mall_link_url')

    const cents = num(pick('goods_price', 'total_amount', 'minOnSaleGroupPrice'))
    if (cents !== null && cents > 0) out.goods_price = Math.round(cents) / 100
    else {
      const yuan = num(pick('goodsPrice', 'couponPromoPrice'))
      if (yuan !== null && yuan > 0) out.goods_price = yuan
    }
    if (!out.goods_id && !out.goods_name && !out.goods_spec) return null
    return out
  } catch (e) {
    return null
  }
}



async function sendText(store, uid, content) {
  const r = await post(store, '/plateau/chat/send_message', {
    data: {
      cmd: 'send_message',
      request_id: requestId(),
      message: {
        to: { role: 'user', uid },
        from: { role: 'mall_cs' },
        content,
        msg_id: null,
        type: 0,
        is_aut: 0,
        manual_reply: 1
      }
    },
    client: 'WEB'
  })
  if (r && r.success) {
    const inner = r.result || {}
    if (inner.result && inner.result !== 'ok') throw new Error(errorCn(inner.reason || inner.error_msg || '发送失败'))
    if (inner.error_code) throw new Error(errorCn(inner.error_msg || inner.error_code))
    return { success: true }
  }
  throw new Error(errorCn(r && (r.error_msg || r.error_code)))
}

async function sendImage(store, uid, imageUrl) {
  const r = await post(store, '/plateau/chat/send_message', {
    data: {
      cmd: 'send_message',
      request_id: requestId(),
      message: {
        to: { role: 'user', uid },
        from: { role: 'mall_cs' },
        content: imageUrl,
        msg_id: null,
        chat_type: 'cs',
        type: 1,
        is_aut: 0,
        manual_reply: 1
      }
    },
    client: 'WEB'
  })
  if (r && r.success) {
    const inner = r.result || {}
    if (inner.result && inner.result !== 'ok') throw new Error(errorCn(inner.reason || inner.error_msg || '发送失败'))
    return { success: true }
  }
  throw new Error(errorCn(r && (r.error_msg || r.error_code)))
}

async function sendVideo(store, uid, videoUrl) {
  
  const r = await post(store, '/plateau/message/library_file/send', { uid, url: videoUrl })
  if (r && r.success === true) return { success: true }
  throw new Error(errorCn(r && (r.error_msg || r.error || r.error_code)))
}


async function sendGoodsCard(store, uid, goodsId, bizType = 2) {
  const r = await post(store, '/plateau/message/send/mallGoodsCard', { uid, goods_id: goodsId, biz_type: bizType })
  if (r && r.success) return { success: true }
  throw new Error(errorCn(r && (r.error_msg || r.error_code)))
}




async function getProductPage(store, pageNum = 1, pageSize = 20) {
  const r = await post(store, '/latitude/goods/recommendGoods', { uid: '', pageNum, pageSize }, 30000,
    BASE + '/goods/goods_list')
  if (!r || !r.success) throw new Error(errorCn(r && (r.error_msg || r.error_code)))
  const inner = (r && r.result) || {}
  
  
  const list = inner.onSaleGoods || inner.goodsList || inner.goods_list || inner.list || []
  return list.map((g) => ({
    goods_id: String(g.goodsId || g.goods_id || ''),
    goods_name: String(g.goodsName || g.goods_name || ''),
    
    
    
    price: g.minOnSaleGroupPrice != null ? Number(g.minOnSaleGroupPrice) / 100 : null,
    price_max: g.maxOnSaleGroupPrice != null ? Number(g.maxOnSaleGroupPrice) / 100 : null,
    sold: g.soldQuantity != null ? Number(g.soldQuantity) : null,
    sold_30d: g.soldQuantity30d != null ? Number(g.soldQuantity30d) : null,
    stock: g.quantity != null ? Number(g.quantity) : null,
    thumb_url: String(g.thumbUrl || g.thumb_url || g.hdThumbUrl || g.goods_img || ''),
    goods_url: String(g.goodsUrl || ''),
    
    spec: String(g.spec || '')
  })).filter((g) => g.goods_id)
}


async function getAllProducts(store, pageSize = 20) {
  const all = []
  for (let page = 1; page <= 50; page++) {
    const list = await getProductPage(store, page, pageSize)
    all.push(...list)
    if (list.length < pageSize) break
  }
  return all
}


async function getProductDetail(store, goodsId) {
  const r = await post(store, '/glide/v2/mms/query/commit/on_shop/detail', { goods_id: String(goodsId) }, 20000,
    BASE + '/goods/goods_list')
  if (!r || !r.success) throw new Error(errorCn(r && (r.error_msg || r.errorMsg || r.error_code)))
  const d = (r && r.result) || {}
  const specifications = []
  for (const sku of (d.skus || [])) {
    const text = (sku.spec || []).map((s) => {
      const parent = s.parent_name || ''
      const name = s.spec_name || ''
      return parent && name ? `${parent}: ${name}` : name
    }).filter(Boolean).join(' | ')
    if (text) specifications.push(text)
  }
  try {
    const cats = Array.isArray(d.cats) ? d.cats.filter(Boolean).map(String) : []
    if (cats.length) specifications.push('商品分类: ' + cats.join(' > '))
  } catch (e) {  }
  return {
    goods_id: d.goods_id || String(goodsId),
    goods_name: d.goods_name || '',
    specifications: specifications.slice(0, 20)
  }
}

module.exports = {
  getConversations, getHistory, sendText, sendImage, sendVideo, sendGoodsCard,
  getProductPage, getAllProducts, getProductDetail, errorCn, SESSION_EXPIRED
}
