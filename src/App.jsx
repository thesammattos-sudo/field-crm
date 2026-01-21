import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import Dashboard from './pages/Dashboard'
import Pipeline from './pages/Pipeline'
import Projects from './pages/Projects'
import ProjectDetail from './pages/ProjectDetail'
import Suppliers from './pages/Suppliers'
import Materials from './pages/Materials'
import Documents from './pages/Documents'
import Activities from './pages/Activities'
import Login from './pages/Login'
import Analytics from './pages/Analytics'

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="pipeline" element={<Pipeline />} />
          <Route path="projects" element={<Projects />} />
          <Route path="projects/:slug" element={<ProjectDetail />} />
          <Route path="suppliers" element={<Suppliers />} />
          <Route path="materials" element={<Materials />} />
          <Route path="documents" element={<Documents />} />
          <Route path="activities" element={<Activities />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="trends" element={<Navigate to="/analytics" replace />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
