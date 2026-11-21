type MapKey = string | number | symbol;
type GenericMap = Record<MapKey, MapKey>;
type MirrorMap<T extends GenericMap> = T & Record<T[keyof T], keyof T>;
export declare function mirror_map<T extends GenericMap>(map: T): MirrorMap<T>;
export {};
