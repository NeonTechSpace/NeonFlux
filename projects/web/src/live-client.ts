import { ConvexReactClient } from "convex/react"
import { useEffect, useState } from "react"
import { clearLiveQueryCache } from "./live-query"

const createClient = (url: string) => new ConvexReactClient(url)
export function useLiveClient(url: string, factory: (url: string) => ConvexReactClient = createClient) {
    const [client, setClient] = useState<ConvexReactClient>()
    useEffect(() => {
        const connection = factory(url)
        setClient(connection)
        return () => {
            clearLiveQueryCache(connection)
            void connection.close()
        }
    }, [url, factory])
    return client
}
