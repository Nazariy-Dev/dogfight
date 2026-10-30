import { expect, test, type Page } from '@playwright/test'

async function join(page: Page, name: string, room: string): Promise<void> {
  await page.goto('/')
  await page.fill('#name', name)
  await page.fill('#newroom', room)
  await page.click('#create button')
  await page
    .locator('#rooms li', { hasText: room })
    .getByRole('button', { name: 'Join' })
    .click()
  await page.waitForFunction(() => window.__app.net?.me != null)
}

test('два гравці в одній кімнаті: рух видно в іншому вікні, чат доходить', async ({
  browser,
}) => {
  const room = `e2e-${Date.now() % 100000}`
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const a = await ctxA.newPage()
  const b = await ctxB.newPage()
  await join(a, 'Alice', room)
  await join(b, 'Bob', room)

  // roster в обох
  for (const p of [a, b])
    await expect
      .poll(() =>
        p.evaluate(
          () => window.__app.net?.view().others.filter((e) => e.kind === 'ship').length,
        ),
      )
      .toBe(1)

  // A газує; B має побачити, що чужий корабель зрушив, не пізніше ніж за 500 мс
  const shipA = await a.evaluate(() => window.__app.net?.shipId)
  const posInB = () =>
    b.evaluate((id) => {
      const e = window.__app.net?.view().others.find((x) => x.id === id)
      return e ? { x: e.x, y: e.y } : null
    }, shipA)
  const before = await posInB()
  await a.bringToFront()
  await a.keyboard.down('ArrowUp')
  const t0 = Date.now()
  await expect
    .poll(
      async () => {
        const p = await posInB()
        return p && before ? Math.hypot(p.x - before.x, p.y - before.y) : 0
      },
      { timeout: 500, intervals: [25] },
    )
    .toBeGreaterThan(5)
  const observedMs = Date.now() - t0
  await a.keyboard.up('ArrowUp')
  test
    .info()
    .annotations.push({ type: 'movement-observed-ms', description: String(observedMs) })

  // чат іде тим самим WebSocket, що й гра
  await a.evaluate(() =>
    window.__app.conn?.send({ type: 'chat', text: 'привіт від Alice' }),
  )
  await expect
    .poll(() => b.evaluate(() => window.__app.chat ?? []), { timeout: 2000 })
    .toContain('Alice: привіт від Alice')

  await ctxA.close()
  await ctxB.close()
})
