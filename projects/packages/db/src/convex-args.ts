type OptionalKeys<T extends object> = {
    [Key in keyof T]-?: undefined extends T[Key] ? Key : never;
}[keyof T];

type RequiredKeys<T extends object> = Exclude<keyof T, OptionalKeys<T>>;

export type CompactConvexArgs<T extends object> = {
    [Key in RequiredKeys<T>]: T[Key];
} & {
    [Key in OptionalKeys<T>]?: Exclude<T[Key], undefined>;
};

export function compactConvexArgs<T extends object>(args: T): CompactConvexArgs<T> {
    return Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined)) as CompactConvexArgs<T>;
}
