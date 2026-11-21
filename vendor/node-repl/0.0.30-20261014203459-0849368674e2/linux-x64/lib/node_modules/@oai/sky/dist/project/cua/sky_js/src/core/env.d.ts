import type { ArrayItem } from "@oai/types";
/**
 * Creates a typed reader for an environment option.
 *
 * Values are trimmed, lowercased, cached on first read, and must match one of `options`.
 *
 * @example
 * ```ts
 * const OAI_SKY_TARBALL_LINUX = env({
 *   name: "OAI_SKY_TARBALL_LINUX",
 *   options: ["skip", "build", "cache"] as const,
 *   default: "cache",
 * });
 * ```
 */
export declare function env<T extends EnvOptionList>(args: EnvArgs<T>): {
    get: () => EnvOption<T>;
    help: () => string;
};
type EnvOptionList = Readonly<Array<string>>;
type EnvOption<T extends EnvOptionList> = ArrayItem<[...T]>;
type EnvArgs<T extends EnvOptionList> = {
    /** Environment variable name to read from `process.env`. */
    name: string;
    /** Allowed normalized values for this environment option. */
    options: T;
    /** Value returned when the environment variable is unset or empty. */
    default: EnvOption<T>;
    /** Controls how unset or empty values are handled. Defaults to `"default"`. */
    missing?: "default" | "throw";
    /** Controls how invalid non-empty values are handled. Defaults to `"throw"`. */
    invalid?: "throw" | "default";
    /** Converts raw environment value before matching it against `options`. */
    normalize?: (raw: string) => string;
};
export {};
