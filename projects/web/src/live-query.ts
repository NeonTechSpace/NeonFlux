import type { ConvexReactClient } from 'convex/react'
import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server'
import { useEffect, useState } from 'react'

/** One live Convex subscription for as long as the component is mounted and args is set. Passing undefined subscribes to nothing.
 *  When args change, the previous result stays until the new one arrives, and current reports whether data matches args */
export function useLiveQuery<Query extends FunctionReference<'query'>>(client: ConvexReactClient, query: Query, args: FunctionArgs<Query> | undefined) {
  const key = args === undefined ? '' : JSON.stringify(args)
  const [state,setState] = useState<{ key: string, data?: FunctionReturnType<Query>, error: boolean }>({ key: '',error: false })
  useEffect(() => {
    if (args === undefined) return
    const watch = client.watchQuery(query,args)
    const update = () => {
      try { const result = watch.localQueryResult(); if (result !== undefined) setState({ key,data: result,error: false }) }
      catch { setState(current => ({ ...current,error: true })) }
    }
    const unsubscribe = watch.onUpdate(update)
    update()
    return unsubscribe
  },[client,key])
  return { data: state.data,error: state.error,current: state.key === key && state.data !== undefined }
}
