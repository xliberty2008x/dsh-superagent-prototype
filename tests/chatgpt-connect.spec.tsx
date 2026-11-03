// @vitest-environment jsdom
import { act, type ComponentType } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.tsx'
import { en } from '../src/client/locales.ts'
import { SettingsSchema } from '../src/policy.ts'

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean }
globalThis.IS_REACT_ACT_ENVIRONMENT = true
type Entry = { name: string; component: ComponentType<Record<string, unknown>> }
let root: Root | undefined
const requests: { path: string; method: string; options: RequestInit }[] = []
let status = { available: true, connected: false, inFlight: false, phase: 'idle', url: undefined as string | undefined }
function serve() {
  requests.length = 0
  status = { available: true, connected: false, inFlight: false, phase: 'idle', url: undefined }
  vi.stubGlobal('fetch', async (path: string, options: RequestInit = {}) => {
    const method = options.method ?? 'GET'
    if (path.startsWith('/native-chatgpt/')) {
      requests.push({ path, method, options })
      if (path.endsWith('/start')) status = { ...status, inFlight: true, phase: 'connecting', url: 'https://auth.openai.com/authorize?state=test-state' }
      if (path.endsWith('/cancel')) status = { ...status, inFlight: false, phase: 'cancelled', url: undefined }
      return Response.json(path.endsWith('/task') ? { id: 'local-ui:task-001', received: 'stored' } : status)
    }
    const route = path.replace('/orchestrator/api/', '').split('?')[0]
    if (route === 'state') return Response.json({ masterId: 'master', paused: false, settings: SettingsSchema.parse({}), sources: [],
      revisions: {}, policy_version: 'v', health: {}, outgoing: [], load: { running: 0, queued: 0 },
      setup: { machine: { stateDir: '/test/state' }, problem: null, feishuProblem: null, accounts: null } })
    if (route === 'overview') return Response.json({ problems: [], person: [], executor: { running: 0, queued: 0, maxWorkers: 1, idle: 0 },
      flow: { triggers: 0, filtered: 0, judged: 0, accepted: 0, evaluating: 0 }, policyVersion: 'v' })
    if (route === 'tickets') return Response.json({ items: [], total: 0, next_offset: null })
    return Response.json({ error: 'unknown test route' }, { status: 404 })
  })
}
async function settle() { for (let i = 0; i < 4; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) }) }
async function mount(name: string) {
  const entries: Entry[] = []
  const t = (key: string) => en[key as keyof typeof en] ?? key
  apply({
    slots: { inject: (_: string, effect: () => void) => effect(), register: (options: { name: string }, component: Entry['component']) => {
      entries.push({ name: options.name, component }); return () => {}
    } },
    locale: { register: () => () => {}, bind: () => t }, effect: (effect: () => unknown) => effect(), get: () => undefined,
    sessions: { list: { getSnapshot: () => ({ phase: 'ready', byId: {} }) }, refresh: async () => {} },
    uiWorkspace: { openSession: () => {} },
  } as never)
  const entry = entries.find(item => item.name === name)
  expect(entry, `registered ${name}`).toBeDefined()
  const container = document.createElement('div'); document.body.append(container)
  root = createRoot(container)
  await act(async () => { root!.render(entry ? <entry.component t={t} /> : null) })
  await settle()
  return container
}
const button = (name: string) => {
  const element = [...document.querySelectorAll('button')].find(item => item.textContent?.trim() === name)
  expect(element, `button ${name}`).toBeDefined()
  return element!
}
async function click(name: string) { await act(async () => { button(name).click() }); await settle() }
async function type(value: string) {
  const input = document.querySelector('textarea')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await settle()
}
afterEach(() => { act(() => { root?.unmount() }); root = undefined; document.body.innerHTML = ''; sessionStorage.clear(); vi.unstubAllGlobals() })

it('starts OAuth only after the user clicks and sends same-origin requests without a body', async () => {
  serve(); await mount('settings.models.footer')
  expect(requests.every(item => item.method === 'GET')).toBe(true)
  await click('Continue with ChatGPT')
  const start = requests.find(item => item.path.endsWith('/start'))!
  expect(start.options).toMatchObject({ method: 'POST', credentials: 'same-origin', headers: { 'x-native-chatgpt-request': '1' } })
  expect(start.options.body).toBeUndefined()
  expect(document.querySelector<HTMLAnchorElement>('a[href^="https://auth.openai.com/"]')?.textContent).toContain('Continue sign-in')
  await click('Cancel sign-in')
  expect(requests.filter(item => item.path.endsWith('/cancel'))).toHaveLength(1)
})

it('does not display an authorization link outside the official HTTPS host', async () => {
  serve(); status = { ...status, inFlight: true, phase: 'connecting', url: 'https://auth.openai.com.evil.example/authorize' }
  await mount('settings.models.footer')
  expect(document.querySelector('a[href*="evil.example"]')).toBeNull()
})

it('requires ChatGPT before submitting a new task', async () => {
  serve(); await mount('main'); await click('New task'); await type('My task')
  expect(document.body.textContent).toContain('Connect ChatGPT in Settings → Models to submit a task.')
  expect(button('Submit task').disabled).toBe(true)
  expect(requests.some(item => item.path.endsWith('/task'))).toBe(false)
})

it('forwards the complete textarea unchanged and opens Execution after submission', async () => {
  serve(); status = { ...status, connected: true, phase: 'authorized' }
  await mount('main'); await click('New task')
  const original = '  Check this exact task.\n\nЗбережи мій текст.  \n'
  await type(original); await click('Submit task')
  const task = requests.find(item => item.path.endsWith('/task'))!
  expect(task.options).toMatchObject({ method: 'POST', credentials: 'same-origin', headers: {
    'x-native-chatgpt-request': '1', 'content-type': 'application/json'
  } })
  expect(JSON.parse(String(task.options.body))).toEqual({ text: original })
  expect(document.querySelector('textarea')).toBeNull()
  expect(JSON.parse(sessionStorage.getItem('dsh-superagent/route')!).route.page).toBe('execution')
})

it('rechecks the connection before sending and retains text when it has expired', async () => {
  serve(); status = { ...status, connected: true, phase: 'authorized' }
  await mount('main'); await click('New task'); await type('Keep this draft')
  status = { ...status, connected: false, phase: 'idle' }
  await click('Submit task')
  expect(requests.some(item => item.path.endsWith('/task'))).toBe(false)
  expect(document.querySelector('textarea')?.value).toBe('Keep this draft')
  expect(document.body.textContent).toContain('Connect ChatGPT in Settings → Models to submit a task.')
})
