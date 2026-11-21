import type { Window } from "../../types/full-desktop/Window";
import type { AccessibilityNode } from "../../types/full-desktop/WindowState";
type AccessibilityNodeData = Omit<AccessibilityNode, "children" | "to_string"> & {
    children: Array<AccessibilityNodeData>;
};
/** Restore presentation after native JSON or trusted RPC deserialization. */
export declare function accessibility_tree(node: AccessibilityNodeData, focused_modal?: Window): AccessibilityNode;
export {};
