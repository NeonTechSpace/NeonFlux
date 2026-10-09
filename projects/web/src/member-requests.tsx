const states = { queued: "Pending", applied: "Done", failed: "Failed" }
/** The member's recent requests and their outcome */
export function MemberRequests<O>({
    requests,
    label,
}: {
    requests: readonly { id: string; operation: O; state: "queued" | "applied" | "failed"; error?: string }[]
    label: (operation: O) => string
}) {
    return (
        <section className="panel" aria-label="Your recent requests">
            <h2>Your recent requests</h2>
            {requests.length ? (
                <ul className="request-list">
                    {requests.map((row) => (
                        <li key={row.id}>
                            {label(row.operation)}: {states[row.state]}
                            {row.error && <p className="error-text">{row.error}</p>}
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="muted">No recent requests</p>
            )}
            <p className="field-help">
                The bot handles each request within seconds while it is online. Requests expire after two minutes, and
                their records are deleted after one day
            </p>
        </section>
    )
}
