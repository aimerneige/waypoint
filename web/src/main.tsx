import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { router } from './app'
import '@fontsource-variable/inter'
import './style.css'
ReactDOM.createRoot(document.getElementById('root')!).render(
  <RouterProvider router={router} />,
)
