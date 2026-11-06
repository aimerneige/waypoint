import React from 'react'
import ReactDOM from 'react-dom/client'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { api } from './api/client'
import { Button } from './ui/components/button'
import '@fontsource-variable/inter'
import './style.css'

export function App() {
  const [status, setStatus] = React.useState('检查中…')
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()
  React.useEffect(() => {
    const controller = new AbortController()
    void api
      .GET('/api/healthz', { signal: controller.signal })
      .then(({ data }) => {
        setStatus(data?.status ?? '服务暂不可用')
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus('无法连接服务')
      })
    return () => controller.abort()
  }, [])
  return (
    <main className="mx-auto max-w-xl space-y-6 p-6">
      <h1 className="text-3xl font-semibold">Waypoint</h1>
      <p role="status">服务状态：{status}</p>
      {needRefresh && (
        <Button
          onClick={() => {
            void updateServiceWorker(true)
          }}
        >
          有更新，点击刷新
        </Button>
      )}
    </main>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
