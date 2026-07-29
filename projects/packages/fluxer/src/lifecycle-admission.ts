type LifecycleAdmissionRejection = 'global-queue-full' | 'key-queue-full' | 'stopped';

export type LifecycleAdmissionOptions = {
    handlerDeadlineMs: number;
    maxActive: number;
    maxQueued: number;
    maxQueuedPerKey: number;
    onHandlerDeadline?: (key: string) => void;
    onQueueDeadline?: (key: string) => void;
    queueDeadlineMs: number;
};

export type LifecycleAdmissionResult =
    | { accepted: false; reason: LifecycleAdmissionRejection }
    | { accepted: true; completion: Promise<void> };

type PendingTask = {
    cancelled: boolean;
    complete: () => void;
    key: string;
    queueDeadline: ReturnType<typeof setTimeout>;
    run: () => Promise<void>;
};

export class LifecycleAdmission {
    readonly #activeKeys = new Set<string>();
    readonly #keyOrder: string[] = [];
    readonly #options: LifecycleAdmissionOptions;
    readonly #queues = new Map<string, PendingTask[]>();
    #accepting = true;
    #activeCount = 0;
    #queuedCount = 0;

    constructor(options: LifecycleAdmissionOptions) {
        this.#options = options;
    }

    admit(key: string, run: () => Promise<void>): LifecycleAdmissionResult {
        if (!this.#accepting) return { accepted: false, reason: 'stopped' };
        const queue = this.#queues.get(key);
        if ((queue?.filter((task) => !task.cancelled).length ?? 0) >= this.#options.maxQueuedPerKey) {
            return { accepted: false, reason: 'key-queue-full' };
        }
        if (this.#queuedCount >= this.#options.maxQueued) {
            return { accepted: false, reason: 'global-queue-full' };
        }

        let complete: () => void = () => undefined;
        const completion = new Promise<void>((resolve) => {
            complete = resolve;
        });
        const task: PendingTask = {
            cancelled: false,
            complete,
            key,
            queueDeadline: setTimeout(() => this.#expireQueuedTask(task), this.#options.queueDeadlineMs),
            run,
        };
        if (queue) {
            queue.push(task);
        } else {
            this.#queues.set(key, [task]);
            this.#keyOrder.push(key);
        }
        this.#queuedCount += 1;
        this.#drain();
        return { accepted: true, completion };
    }

    stopIntake(): void {
        this.#accepting = false;
    }

    cancelQueued(): void {
        for (const queue of this.#queues.values()) {
            for (const task of queue) {
                if (task.cancelled) continue;
                task.cancelled = true;
                clearTimeout(task.queueDeadline);
                this.#queuedCount -= 1;
                task.complete();
            }
        }
        this.#queues.clear();
        this.#keyOrder.length = 0;
    }

    #drain(): void {
        while (this.#activeCount < this.#options.maxActive) {
            const task = this.#takeNext();
            if (!task) return;
            this.#start(task);
        }
    }

    #expireQueuedTask(task: PendingTask): void {
        if (task.cancelled) return;
        task.cancelled = true;
        this.#queuedCount -= 1;
        task.complete();
        this.#options.onQueueDeadline?.(task.key);
        this.#drain();
    }

    #start(task: PendingTask): void {
        task.cancelled = true;
        clearTimeout(task.queueDeadline);
        this.#queuedCount -= 1;
        this.#activeCount += 1;
        this.#activeKeys.add(task.key);

        const handlerDeadline = setTimeout(
            () => this.#options.onHandlerDeadline?.(task.key),
            this.#options.handlerDeadlineMs
        );
        let pending: Promise<void>;
        try {
            pending = task.run();
        } catch (error) {
            pending = Promise.reject(error instanceof Error ? error : new Error('Lifecycle handler failed'));
        }
        const settle = () => {
            clearTimeout(handlerDeadline);
            this.#activeCount -= 1;
            this.#activeKeys.delete(task.key);
            task.complete();
            this.#drain();
        };
        void pending.then(settle, settle);
    }

    #takeNext(): PendingTask | undefined {
        const keyCount = this.#keyOrder.length;
        for (let index = 0; index < keyCount; index += 1) {
            const key = this.#keyOrder.shift();
            if (!key) return undefined;
            const queue = this.#queues.get(key);
            if (!queue) continue;
            while (queue[0]?.cancelled) queue.shift();
            if (queue.length === 0) {
                this.#queues.delete(key);
                continue;
            }
            this.#keyOrder.push(key);
            if (this.#activeKeys.has(key)) continue;

            const task = queue.shift();
            if (queue.length === 0) {
                this.#queues.delete(key);
                this.#keyOrder.pop();
            }
            if (task) return task;
        }
        return undefined;
    }
}
