import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { configured } from './lib/supabase'
import { JudgeLayout } from './lib/judgeSession'
import Welcome from './pages/Welcome'
import JudgeHome from './pages/JudgeHome'
import JudgeEvaluate from './pages/JudgeEvaluate'
import { FullSpinner } from './components/ui'

// Admin and projector screens are code-split so judges' phones download less.
const Admin = lazy(() => import('./pages/Admin'))
const Present = lazy(() => import('./pages/Present'))

export default function App() {
  if (!configured) {
    return (
      <main className="mx-auto max-w-lg p-6">
        <h1 className="text-xl font-bold text-bad">Supabase is not configured</h1>
        <p className="mt-2 text-slate-600">
          Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (see <code>.env.example</code>) and rebuild.
        </p>
      </main>
    )
  }
  return (
    <Suspense fallback={<FullSpinner />}>
    <Routes>
      <Route path="/" element={<Welcome />} />
      <Route element={<JudgeLayout />}>
        <Route path="/judge" element={<JudgeHome />} />
        <Route path="/judge/project/:number" element={<JudgeEvaluate />} />
      </Route>
      <Route path="/admin" element={<Admin />} />
      <Route path="/present" element={<Present />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  )
}
