'use strict'

const api = require('./api')

async function main() {
  // Use credentials obtained through an authorized merchant login flow.
  const store = {
    cookies: [
      { name: 'cookie_name', value: 'cookie_value' }
    ],
    anti_content: '',
    mallId: ''
  }

  const conversations = await api.getConversations(store)
  if (!conversations.length) return

  const customer = conversations[0]
  const messages = await api.getHistory(store, customer.uid, 20)
  console.log({ customer, messages })

  await api.sendText(store, customer.uid, '您好，请问有什么可以帮您？')
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
