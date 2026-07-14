type AuthenticatedJourneyPhase = {
    name: string;
    run: () => Promise<void>;
};

type AuthenticatedJourneyOrchestration = {
    cleanup: (started: boolean) => Promise<void>;
    phases: readonly AuthenticatedJourneyPhase[];
    start: () => Promise<void>;
};

export async function runAuthenticatedJourneyOrchestration(
    orchestration: AuthenticatedJourneyOrchestration
): Promise<void> {
    const errors: unknown[] = [];
    let started = false;

    try {
        await orchestration.start();
        started = true;

        for (const phase of orchestration.phases) {
            try {
                await phase.run();
            } catch (error) {
                errors.push(new Error(`Authenticated journey phase ${phase.name} failed.`, { cause: error }));
            }
        }
    } catch (error) {
        errors.push(new Error('Authenticated journey environment startup failed.', { cause: error }));
    } finally {
        try {
            await orchestration.cleanup(started);
        } catch (error) {
            errors.push(new Error('Authenticated journey environment cleanup failed.', { cause: error }));
        }
    }

    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, 'Authenticated journey orchestration failed.');
}
