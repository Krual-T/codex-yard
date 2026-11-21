import type { AccessibilityNode } from "../../types/full-desktop/WindowState";
type AccessibilityNodeData = Omit<AccessibilityNode, "children" | "to_string"> & {
    children: Array<AccessibilityNodeData>;
};
/** Restore presentation after native JSON or trusted RPC deserialization. */
export declare function accessibility_tree(node: AccessibilityNodeData): AccessibilityNode;
export {};
