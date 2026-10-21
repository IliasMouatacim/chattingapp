import { test, expect } from '@playwright/test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const join = async (page, name) => {
  await page.goto('/')
  await page.getByPlaceholder('Enter your display name').fill(name)
  await page.getByRole('button', { name: 'Join Space' }).click()
  await expect(page.locator('.chat-header h1')).toHaveText('Global Room')
}
const send = async (page, message) => {
  await page.getByPlaceholder('Type a message...').fill(message)
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
}
const joinRoom = async (page, room) => {
  await page.getByPlaceholder('Enter room code').fill(room)
  await page.getByRole('button', { name: 'Join private room' }).click()
}
const checkAccessibility = async (page) => {
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') })
  const violations = await page.evaluate(async () => {
    const results = await window.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
    })
    return results.violations.map(({ id, nodes }) => ({
      id,
      targets: nodes.map((node) => node.target),
    }))
  })
  expect(violations).toEqual([])
}

test('welcome and conversation pass automated accessibility checks', async ({
  page,
}) => {
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await expect(page).toHaveTitle('Orbit — Your space to connect')
  await expect(page.getByRole('button', { name: 'Join Space' })).toBeDisabled()
  await checkAccessibility(page)
  await join(page, 'Ilias')
  await send(page, 'A fresh start.')
  await checkAccessibility(page)
  expect(errors).toEqual([])
})

test('search, room sharing, multiline messages, and separate chat drafts', async ({
  page,
  context,
}) => {
  await join(page, 'Ilias')
  const friend = await context.newPage()
  await join(friend, 'Maya')
  await send(friend, 'Hello, Orbit!')
  await expect(page.getByText('Hello, Orbit!', { exact: true })).toBeVisible()
  await page.getByPlaceholder('Find people or rooms').fill('nobodyxyz')
  await expect(page.getByText('No matches for “nobodyxyz”')).toBeVisible()
  await page
    .getByRole('button', { name: 'Clear search', exact: true })
    .first()
    .click()
  await page.getByPlaceholder('Type a message...').fill('My global draft')
  await joinRoom(page, 'Design Studio')
  await expect(page.getByPlaceholder('Type a message...')).toHaveValue('')
  await joinRoom(friend, 'Design Studio')
  await page.bringToFront()
  await page
    .getByRole('button', { name: 'Copy room code', exact: true })
    .first()
    .click()
  await expect(
    page.getByText('Room code copied. Share it with a friend!'),
  ).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'DesignStudio',
  )
  await page.getByPlaceholder('Type a message...').fill('First line')
  await page.getByPlaceholder('Type a message...').press('Shift+Enter')
  await page
    .getByPlaceholder('Type a message...')
    .pressSequentially('Second line')
  await page.getByPlaceholder('Type a message...').press('Enter')
  await expect(
    friend.getByText('First line\nSecond line', { exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: /Global Room/ }).click()
  await expect(page.getByPlaceholder('Type a message...')).toHaveValue(
    'My global draft',
  )
  await friend.close()
})

test('mobile navigation, focus containment, details and small screens', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await join(page, 'Ilias')
  await expect(page.locator('#chat-navigation')).toBeHidden()
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await expect(
    page.getByRole('dialog', { name: 'Conversations' }),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Close navigation', exact: true })
    .last()
    .focus()
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('button', { name: 'Leave space' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(
    page.getByRole('button', { name: 'Open navigation' }),
  ).toBeFocused()
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await joinRoom(page, '!!!')
  await expect(page.getByRole('alert')).toContainText('Use letters, numbers')
  await joinRoom(page, 'weekend')
  await expect(page.locator('#chat-navigation')).toBeHidden()
  await expect(page.locator('.chat-header h1')).toHaveText('weekend')
  await page
    .getByRole('button', { name: 'Conversation details', exact: true })
    .click()
  await expect(
    page.getByRole('complementary', { name: 'Conversation details' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Close details', exact: true }).click()
  for (const width of [320, 390, 768, 1024]) {
    await page.setViewportSize({ width, height: 844 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await checkAccessibility(page)
})

test('connection loss preserves a draft and disables sending', async ({
  page,
  context,
}) => {
  await join(page, 'Ilias')
  await page.getByPlaceholder('Type a message...').fill('Keep this thought')
  const cdp = await context.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
  })
  await expect(
    page.getByText(
      'Connection interrupted. We’ll reconnect automatically. Your draft is safe.',
    ),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Send message', exact: true }),
  ).toBeDisabled()
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  })
  await expect(page.getByPlaceholder('Type a message...')).toHaveValue(
    'Keep this thought',
  )
  await expect(
    page.getByRole('button', { name: 'Send message', exact: true }),
  ).toBeEnabled()
})

test('video call dialogs and permission errors remain usable', async ({
  page,
  context,
}) => {
  await join(page, 'Ilias')
  const friend = await context.newPage()
  await join(friend, 'Maya')
  await page
    .getByRole('button', { name: /Maya Here for a conversation/ })
    .click()
  await page.getByRole('button', { name: 'Start Video Call' }).click()
  await friend.getByRole('button', { name: 'Accept', exact: true }).click()
  await expect(
    page.getByRole('dialog', { name: 'Video call', exact: true }),
  ).toBeVisible()
  await page.waitForFunction(
    () =>
      document.querySelector('.remote-video')?.srcObject?.getTracks().length >
      0,
  )
  await friend.waitForFunction(
    () =>
      document.querySelector('.remote-video')?.srcObject?.getTracks().length >
      0,
  )
  await page.getByRole('button', { name: 'Hang Up' }).click()
  await expect(friend.locator('.active-call-overlay')).toBeHidden()
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException('Denied', 'NotAllowedError')
    }
  })
  await page.getByRole('button', { name: 'Start Video Call' }).click()
  await expect(page.getByRole('alert')).toContainText(
    'Check camera and microphone permissions',
  )
  await page.getByRole('button', { name: 'Dismiss call error' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Start Video Call' }),
  ).toBeEnabled()
  await friend.close()
})
