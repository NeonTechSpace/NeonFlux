const style = { dateStyle: 'medium',timeStyle: 'short' } as const
/** A moment as a date and time in the viewer's own locale and time zone, such as Oct 10, 2026, 12:21 PM in the US. Takes
 *  milliseconds since 1970 or an ISO date string. Tests pass a fixed locale */
export function localTime(at: number | string, locale?: string) {
  return new Date(at).toLocaleString(locale,style)
}
