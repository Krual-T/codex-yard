import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";var t;function n(){return(n=e((()=>{t=`(() => {
var __dilDefaultExport = (function() {


//#region internal/text-only-markdown.dil.tsx
/** Host-rendered text formatting, without link navigation or image loading. */
	function TextOnlyMarkdown({ children }) {
		return /* @__PURE__ */ __dil.jsx("text-only-markdown", null, children);
	}

//#endregion
//#region shared.dil.ts
	function useResolvedComponentResult(componentName, props) {
		const opGenui = DIL.useAppData((appData) => appData.opGenui);
		if (props.__state !== void 0) return {
			status: "resolved",
			resolutionComplete: true,
			state: props.__state
		};
		const key = componentDataKey(componentName, props);
		const result = (typeof props.__resolutionId === "string" ? opGenui?.componentResults?.[props.__resolutionId] : void 0) ?? opGenui?.componentResults?.[key];
		if (isComponentResultEnvelope(result)) {
			if (result.status === "pending") return {
				status: "pending",
				resolutionComplete: false,
				state: void 0
			};
			return result.status === "resolved" ? {
				status: "resolved",
				resolutionComplete: true,
				state: result.state
			} : {
				status: "failed",
				resolutionComplete: true,
				state: void 0
			};
		}
		const legacyState = opGenui?.componentData?.[key];
		if (legacyState !== void 0) return {
			status: "resolved",
			resolutionComplete: true,
			state: legacyState
		};
		if (opGenui?.componentResults !== void 0) return {
			status: "failed",
			resolutionComplete: true,
			state: void 0
		};
		if (opGenui?.componentData !== void 0) return {
			status: "resolved",
			resolutionComplete: true,
			state: void 0
		};
		return {
			status: "pending",
			resolutionComplete: false,
			state: void 0
		};
	}
	function isComponentResultEnvelope(value) {
		if (typeof value !== "object" || value == null || Array.isArray(value)) return false;
		const result = value;
		if (result.status === "pending") return true;
		if (result.status === "resolved") return typeof result.state === "object" && result.state != null && !Array.isArray(result.state);
		return result.status === "failed" && (result.code === "component_unavailable" || result.code === "tool_failed" || result.code === "invalid_tool_result") && typeof result.retryable === "boolean";
	}
	function componentDataKey(componentName, props) {
		return JSON.stringify([componentName, normalizeComponentProps(props)]);
	}
	function normalizeComponentProps(props) {
		const normalized = {};
		for (const key of Object.keys(props).sort()) {
			if (key === "__resolutionId" || key === "__state" || key === "children" || key === "fallback") continue;
			const value = normalizeComponentValue(props[key]);
			if (value !== void 0) normalized[key] = value;
		}
		return normalized;
	}
	function normalizeComponentValue(value) {
		if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return value;
		if (Array.isArray(value)) return value.map(normalizeComponentValue);
		if (typeof value === "object") {
			const normalized = {};
			for (const key of Object.keys(value).sort()) {
				const nestedValue = normalizeComponentValue(value[key]);
				if (nestedValue !== void 0) normalized[key] = nestedValue;
			}
			return normalized;
		}
	}

//#endregion
//#region TabbedSectionWidget.dil.tsx
	function TabbedSectionView({ state }) {
		const [activeIndex, setActiveIndex] = DIL.useState(state.active_index ?? 0);
		const activeTab = state.tabs[activeIndex];
		const tabs = state.tabs.map((tab, index) => /* @__PURE__ */ __dil.jsx("button", {
			key: tab.id,
			variant: activeIndex === index ? "solid" : "outline",
			onClick: () => setActiveIndex(index)
		}, tab.label));
		const content = activeTab ? /* @__PURE__ */ __dil.jsx("col", {
			flex: "auto",
			gap: 1
		}, /* @__PURE__ */ __dil.jsx("title", { size: "md" }, activeTab.title), /* @__PURE__ */ __dil.jsx(TextOnlyMarkdown, null, activeTab.content)) : null;
		return /* @__PURE__ */ __dil.jsx("card", { size: "full" }, state.vertical_tab ? /* @__PURE__ */ __dil.jsx("row", {
			align: "stretch",
			gap: 4
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: 2,
			padding: { right: 3 },
			border: { right: { size: 1 } }
		}, tabs), content) : /* @__PURE__ */ __dil.jsx("col", { gap: 3 }, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 2,
			wrap: "wrap"
		}, tabs), /* @__PURE__ */ __dil.jsx("divider", null), content));
	}
	function TabbedSectionWidget(props) {
		const { resolutionComplete, state } = useResolvedComponentResult("TabbedSectionWidget", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 160
		});
		return /* @__PURE__ */ __dil.jsx(TabbedSectionView, { state });
	}

//#endregion
return TabbedSectionWidget;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=tabbed-section-widget-616a655ca54e.js.map