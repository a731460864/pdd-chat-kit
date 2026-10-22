/*
 * Copyright (c) 2026 惠民惠爱电子商务有限公司
 * SPDX-License-Identifier: MIT
 */










export const PDD_CODES = {
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
  1002: 'other',
  1000: 'text'
}



export const CONTEXT_ONLY_TYPES = new Set(['41'])


export function extractGoodsId(text) {
  const s = String(text || '')
  const m = s.match(/[?&]goods_id=(\d{6,})/i) || s.match(/goods_id[=/](\d{6,})/i)
  return m ? m[1] : ''
}

export function isGoodsMessage(text) {
  const s = String(text || '')
  if (!s) return false
  if (!/(yangkeduo\.com|pinduoduo\.com|pddpic\.com)/i.test(s)) return false
  return !!extractGoodsId(s)
}


export function pddGoodsContextFrom(raw) {
  const out = { goods_id: '', goods_name: '', goods_price: null, goods_thumb: '', goods_spec: '', goods_link: '' }
  if (!raw || typeof raw !== 'object') return out
  const layers = []
  const pushLayer = (x) => { if (x && typeof x === 'object' && !Array.isArray(x)) layers.push(x) }
  for (const info of [raw.message && raw.message.info, raw.info]) {
    pushLayer(info)
    if (info && typeof info === 'object') {
      pushLayer(info.data)        
      pushLayer(info.goods_info)  
    }
  }
  
  const ctx = raw.context
  if (ctx && typeof ctx === 'object') pushLayer(ctx.n_context)
  pushLayer(raw.biz_context)

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
  if (cents !== null && cents > 0) {
    out.goods_price = Math.round(cents) / 100
  } else {
    const yuan = num(pick('goodsPrice', 'couponPromoPrice'))
    if (yuan !== null && yuan > 0) out.goods_price = yuan
  }
  return out
}

export default {
  key: 'pdd',
  name: '拼多多',
  notifyName: '拼多多',
  capabilities: { text: true, image: true, video: true, emoji: true },
  codeTable: PDD_CODES,
  contextOnlyTypes: CONTEXT_ONLY_TYPES,
  extractGoodsId,
  isGoodsMessage,
  parseContext: (data) => {
    if (!data || !data.raw) return { goods: null }
    try {
      return { goods: pddGoodsContextFrom(data.raw) }
    } catch (e) {
      return { goods: null }
    }
  }
}
