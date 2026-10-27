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
//#region SidebarFactTable.dil.tsx
	function SidebarFactTable(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("SidebarFactTable", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 120
		});
		return /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			border: { top: {
				size: 1,
				color: "subtle"
			} },
			...GenUI.logEvent ? { onVisible: () => GenUI.logEvent?.({
				event_name: "sidebar_fact_table_widget_shown",
				statsig_event_name: "sidebar_fact_table_widget_shown",
				event_data: { widget_name: "sidebar_fact_table" }
			}) } : {}
		}, /* @__PURE__ */ __dil.jsx("table", { columnSizing: "equal" }, /* @__PURE__ */ __dil.jsx("table-section", null, state.facts.map((fact, index) => /* @__PURE__ */ __dil.jsx("table-row", { key: index }, /* @__PURE__ */ __dil.jsx("table-cell", null, /* @__PURE__ */ __dil.jsx("row", {
			gap: 1,
			align: "start",
			wrap: "wrap"
		}, /* @__PURE__ */ __dil.jsx("text", { strong: true }, \`\${fact.key}:\`), fact.entity_name != null ? /* @__PURE__ */ __dil.jsx("pressable", {
			inline: true,
			onClick: () => GenUI.dispatchAction({
				handler: "client",
				type: "open_entity_detail",
				payload: fact.action_payload
			})
		}, /* @__PURE__ */ __dil.jsx("text", {
			inline: true,
			underline: "dotted"
		}, fact.entity_name)) : /* @__PURE__ */ __dil.jsx("text", null, fact.plain_text))))))));
	}

//#endregion
return SidebarFactTable;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=sidebar-fact-table-6e19d07213d8.js.map