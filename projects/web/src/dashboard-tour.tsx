import { useEffect, useRef, useState } from 'react'

// A short guided tour for a manager's first visit. Whether it was finished or dismissed is kept in this browser per account: The tour
// guards nothing and losing the mark only shows a dismissible tour again, so it needs no backend record
export const tourSteps: ReadonlyArray<{ title: string, text: string }> = [
  { title: 'Setup progress at a glance',text: 'The Overview shows which features are on, on but needing setup, such as a channel or a first entry, or off. Its permission check asks NeonFlux to check its own permissions and role position, and names the fix for each problem' },
  { title: 'Sections',text: 'The sidebar groups every feature into sections, and the Overview links to each one. Every server and section has its own address, so reloading, the back button and shared links return to the same place. Server structure under Basics shows the categories, channels and threads, where you can rename and reorder them' },
  { title: 'Drafts and saving',text: 'Unsaved changes stay as drafts in this browser tab until you save or discard them, and the sidebar marks sections that hold one. After you save, NeonFlux applies the change and the section shows whether it was applied, or why it failed' },
  { title: 'The audit log',text: 'Audit log under Insights lists every setting change, whether it was made here or with a chat command, with who made it and what changed' },
  { title: 'Chat commands',text: 'In the server, !setup sums up the same setup progress, and a feature after it, as in !setup tickets, shows that feature\'s next step. !health runs the permission check, and !help lists the commands you can use. The prefix may differ if the server changed it' },
]
const storageKey = (userId: string) => `neonflux:dashboard-tour:${userId}`
function seen(userId: string) { try { return window.localStorage.getItem(storageKey(userId)) === 'done' } catch { return false } }

/** Whether the tour is open. It opens on its own until the account finishes or dismisses it once in this browser */
export function useDashboardTour(userId: string) {
  const [open,setOpen] = useState(() => !seen(userId))
  return { open,start: () => setOpen(true),close: () => {
    setOpen(false)
    // Private browsing can refuse storage. The tour then stays closed for this visit
    try { window.localStorage.setItem(storageKey(userId),'done') } catch {}
  } }
}

/** The tour itself, a non-modal dialog above the open section. Escape or Skip tour closes it, and each step moves focus to its heading */
export function DashboardTour({ onClose }: { onClose: () => void }) {
  const [index,setIndex] = useState(0), heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() },[index])
  const step = tourSteps[index]!, last = index === tourSteps.length - 1
  return <section className="panel tour" role="dialog" aria-modal="false" aria-labelledby="tour-title" aria-describedby="tour-text" onKeyDown={event => { if (event.key === 'Escape') onClose() }}>
    <p className="eyebrow">Dashboard tour, step {index + 1} of {tourSteps.length}</p>
    <h2 id="tour-title" tabIndex={-1} ref={heading}>{step.title}</h2>
    <p id="tour-text">{step.text}</p>
    <div className="actions">
      <button type="button" className="secondary" disabled={!index} onClick={() => setIndex(index - 1)}>Previous step</button>
      <button type="button" onClick={() => last ? onClose() : setIndex(index + 1)}>{last ? 'Finish tour' : 'Next step'}</button>
      <button type="button" className="secondary" onClick={onClose}>Skip tour</button>
    </div>
  </section>
}
