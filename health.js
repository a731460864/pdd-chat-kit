/*
 * Copyright (c) 2026 惠民惠爱电子商务有限公司
 * SPDX-License-Identifier: MIT
 */













'use strict'

const HOME_URL = 'https://mms.pinduoduo.com/home'


async function checkSessionAlive(page) {
  try {
    await page.goto(HOME_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(5000)
    const u = String(page.url())
    return { ok: !/\/login/i.test(u), url: u }
  } catch (e) {
    let u = ''
    try { u = String(page.url()) } catch (er) {  }
    return { ok: false, url: u, error: e && e.message }
  }
}

module.exports = { checkSessionAlive, HOME_URL }
