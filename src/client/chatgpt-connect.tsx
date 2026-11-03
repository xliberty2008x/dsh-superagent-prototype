/** Browser controls for the native ChatGPT authorization and local-task endpoints. */
import { useRef, useState, type FormEvent } from 'react'
import { usePoll } from './api.ts'
import { Button, Icon, Modal } from './controls.tsx'
import STYLES from './client.css?raw'

// The stock Models package declares this optional extension at runtime. Its client package is not a prototype build dependency.
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'settings.models.footer': { kind: 'list'; scope: 'root'; owner: { children?: never } }
  }
}

interface ChatGPTStatus {
  available: boolean
  connected: boolean
  inFlight: boolean
  phase: 'idle' | 'connecting' | 'authorized' | 'cancelled' | 'failed'
  url?: string
  error?: string
}
const CONNECT_REQUIRED = 'Connect ChatGPT in Settings → Models to submit a task.'
async function request<T>(path: 'status' | 'start' | 'cancel' | 'task', method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/native-chatgpt/${path}`, {
    method, credentials: 'same-origin', headers: {
      'x-native-chatgpt-request': '1', ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (!response.ok) throw new Error(`ChatGPT request failed (${response.status}).`)
  const text = await response.text()
  return (text ? JSON.parse(text) : {}) as T
}
const readStatus = () => request<ChatGPTStatus>('status')
function authorizationUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (url.protocol === 'https:' && url.hostname === 'auth.openai.com' && !url.username && !url.password
      && (!url.port || url.port === '443')) return url.href
  } catch { /* An invalid authorization destination is never offered as a link. */ }
  return undefined
}

/** Mounted in the stock Models footer; OAuth begins only in the click handler. */
export function ChatGPTConnect() {
  const { data: status, error, reload } = usePoll(readStatus, [], 2000)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string>()
  const pending = useRef(false)
  const act = async (path: 'start' | 'cancel') => {
    if (pending.current) return
    pending.current = true; setBusy(true); setFailure(undefined)
    try { await request(path, 'POST'); await reload() }
    catch { setFailure('Could not update the ChatGPT connection. Please try again.') }
    finally { pending.current = false; setBusy(false) }
  }
  const url = status?.inFlight ? authorizationUrl(status.url) : undefined
  return <section className="dt-chatgpt-card" aria-label="ChatGPT connection">
    <style>{STYLES}</style>
    <h3>ChatGPT subscription</h3>
    <p role="status">{status?.connected ? 'ChatGPT connected' : status?.inFlight ? 'Waiting for ChatGPT sign-in'
      : status?.available === false ? 'ChatGPT sign-in is unavailable.' : status ? 'ChatGPT is not connected.' : 'Checking ChatGPT connection…'}</p>
    {(failure || error || status?.error) && <p className="dt-error" role="alert">
      {failure ?? (error ? 'Could not read the ChatGPT connection.' : status?.error)}
    </p>}
    <div className="dt-toolbar">
      {!status?.connected && <Button variant="primary" disabled={!status?.available || status.inFlight || busy}
        onClick={() => { void act('start') }}>Continue with ChatGPT</Button>}
      {url && <a className="dt-inline-link" href={url} target="_blank" rel="noopener noreferrer">Continue sign-in</a>}
      {status?.inFlight && <Button variant="outline" disabled={busy} onClick={() => { void act('cancel') }}>Cancel sign-in</Button>}
      <a className="dt-inline-link" href="https://chatgpt.com/settings/usage" target="_blank" rel="noopener noreferrer">Manage usage</a>
    </div>
  </section>
}

function TaskComposer({ onClose, onSubmitted }: { onClose: () => void; onSubmitted: () => void }) {
  const { data: status, error, reload } = usePoll(readStatus, [], 2000)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string>()
  const pending = useRef(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (pending.current || !text.trim()) return
    pending.current = true; setBusy(true); setFailure(undefined)
    try {
      // Recheck immediately before submission so an expired grant cannot use a stale poll result.
      if (!(await readStatus()).connected) { setFailure(CONNECT_REQUIRED); await reload(); return }
      await request<{ id: string; received: unknown }>('task', 'POST', { text })
      onSubmitted()
    } catch { setFailure('Could not submit the task. Your text has been kept.') }
    finally { pending.current = false; setBusy(false) }
  }
  const close = () => { if (!pending.current) onClose() }
  return <Modal open onClose={close} title="New task" closeLabel="Close" description="Send a task to Superagent using your ChatGPT connection.">
    <form className="dt-form" onSubmit={event => { void submit(event) }}>
      <label htmlFor="dt-new-task">Task</label>
      <textarea id="dt-new-task" className="dt-textarea" rows={10} value={text} disabled={busy}
        onChange={event => setText(event.target.value)} />
      {!status?.connected && <p className="dt-hint" role="status">{status ? CONNECT_REQUIRED : 'Checking ChatGPT connection…'}</p>}
      {(failure || error) && <p className="dt-error" role="alert">{failure ?? 'Could not read the ChatGPT connection.'}</p>}
      <div className="dt-toolbar">
        <Button variant="outline" disabled={busy} onClick={close}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={busy || !status?.connected || !text.trim()}>
          {busy ? 'Submitting…' : 'Submit task'}
        </Button>
      </div>
    </form>
  </Modal>
}

/** Task text is submitted verbatim; the native backend owns routing and execution. */
export function NewTaskButton({ onSubmitted }: { onSubmitted: () => void }) {
  const [open, setOpen] = useState(false)
  return <>
    <Button variant="primary" size="sm" icon={<Icon name="plus" />} onClick={() => setOpen(true)}>New task</Button>
    {open && <TaskComposer onClose={() => setOpen(false)} onSubmitted={() => { setOpen(false); onSubmitted() }} />}
  </>
}
