import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import stylesheet from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }, { title: 'NeonFlux dashboard' }],
    links: [{ rel: 'stylesheet', href: stylesheet }],
  }),
  component: Root,
  notFoundComponent: () => <main><h1>Page not found</h1><a href="/">Return to the dashboard</a></main>,
  errorComponent: () => <main><h1>Unable to load this page</h1><p>Reload to try again</p><a href="/">Return to the dashboard</a></main>,
})

function Root() {
  return <html lang="en"><head><HeadContent /></head><body><Outlet /><Scripts /></body></html>
}
