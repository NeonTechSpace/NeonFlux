import { createFileRoute } from '@tanstack/react-router'
import { Dashboard, dashboardSearch } from '../dashboard'

// The server and section live in the address, so each has a link and the back button returns to the previous one
export const Route = createFileRoute('/')({ validateSearch: dashboardSearch, component: DashboardRoute })
function DashboardRoute() {
  const location = Route.useSearch(), navigate = Route.useNavigate()
  return <Dashboard location={location} navigate={next => void navigate({ search: next })} />
}
