import { ConvexReactClient } from 'convex/react'
import { useEffect, useState } from 'react'

const createClient = (url: string) => new ConvexReactClient(url)
export function useLiveClient(url: string, factory: (url: string) => ConvexReactClient = createClient) {
  const [client, setClient] = useState<ConvexReactClient>()
  useEffect(() => {
    const connection = factory(url)
    setClient(connection)
    return () => { void connection.close() }
  }, [url, factory])
  return client
}
