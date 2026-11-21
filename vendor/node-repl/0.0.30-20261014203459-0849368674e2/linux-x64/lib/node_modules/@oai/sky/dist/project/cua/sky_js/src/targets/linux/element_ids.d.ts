import type { Window } from "../../types/full-desktop/Window";
import type { AccessibilityNode } from "../../types/full-desktop/WindowState";
type NodeData = Omit<AccessibilityNode, "children" | "to_string"> & {
    children: Array<NodeData>;
};
export declare class ElementIds {
    private next_id;
    private windows;
    assign(tree: NodeData, window: Window, filtered: boolean): void;
    resolve<Input extends {
        window?: Window;
        element_id?: string;
    }>(input: Input): Input;
}
export {};
