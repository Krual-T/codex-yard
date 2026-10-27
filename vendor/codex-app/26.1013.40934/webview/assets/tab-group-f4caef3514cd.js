import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";var t;function n(){return(n=e((()=>{t=`(() => {
var __dilDefaultExport = (function() {


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
//#region TabGroup.dil.tsx
	function TabGroupView({ state }) {
		const [localActiveTab, setActiveTab] = DIL.useState(void 0);
		const activeTab = localActiveTab === void 0 ? state.active_tab_id : localActiveTab;
		return /* @__PURE__ */ __dil.jsx("col", {
			width: "100%",
			gap: 0,
			padding: { bottom: 2 }
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			minWidth: 0,
			scrollable: true
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 0,
			width: "max-content"
		}, state.tabs.map((tab, index) => /* @__PURE__ */ __dil.jsx("pressable", {
			key: index,
			flex: "0 0 auto",
			padding: {
				left: 2,
				right: 3,
				top: 2,
				bottom: 0
			},
			ariaLabel: tab.label,
			onClick: () => {
				setActiveTab(tab.label);
				if (activeTab !== tab.label) GenUI.dispatchAction({
					handler: "client",
					type: "issue_new_turn",
					payload: { query: tab.query }
				});
			}
		}, /* @__PURE__ */ __dil.jsx("col", {
			align: "center",
			gap: .5
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: activeTab === tab.label ? "semibold" : "medium",
			color: activeTab === tab.label ? {
				light: "#202124",
				dark: "#F1F3F4"
			} : {
				light: "#70757A",
				dark: "#9AA0A6"
			}
		}, tab.label), /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			height: 3,
			radius: "xs",
			background: activeTab === tab.label ? {
				light: "#202124",
				dark: "#F1F3F4"
			} : "transparent"
		})))))), /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			height: 1,
			background: {
				light: "#DADCE0",
				dark: "#3C4043"
			}
		}));
	}
	function TabGroup(props) {
		const { resolutionComplete, state } = useResolvedComponentResult("TabGroup", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 44
		});
		return /* @__PURE__ */ __dil.jsx(TabGroupView, { state });
	}

//#endregion
return TabGroup;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=tab-group-f4caef3514cd.js.map