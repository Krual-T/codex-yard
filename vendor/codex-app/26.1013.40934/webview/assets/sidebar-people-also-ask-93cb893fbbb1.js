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
//#region SidebarPeopleAlsoAsk.dil.tsx
	function SidebarPeopleAlsoAsk(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("SidebarPeopleAlsoAsk", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 160
		});
		if (state.suggestions.length === 0) return null;
		return /* @__PURE__ */ __dil.jsx("box", {
			width: "40rem",
			maxWidth: "100%",
			gap: 2.5,
			...GenUI.logEvent ? { onVisible: () => GenUI.logEvent?.({
				event_name: "sidebar_people_also_ask_shown",
				statsig_event_name: "sidebar_people_also_ask_shown",
				event_data: {
					category: state.category,
					widget_name: "sidebar_people_also_ask"
				}
			}) } : {}
		}, /* @__PURE__ */ __dil.jsx("box", { width: "100%" }, /* @__PURE__ */ __dil.jsx("table", { dividers: false }, /* @__PURE__ */ __dil.jsx("table-section", { rowDivider: 0 }, state.suggestions.map((suggestion, index) => /* @__PURE__ */ __dil.jsx("table-row", { key: suggestion.prompt_text }, /* @__PURE__ */ __dil.jsx("table-cell", { padding: index === 0 ? {
			top: 0,
			bottom: 1
		} : { y: 1 } }, /* @__PURE__ */ __dil.jsx("pressable", {
			width: "100%",
			padding: 0,
			onClick: () => GenUI.dispatchAction({
				handler: "client",
				type: "open_entity_detail",
				payload: {
					query: suggestion.prompt_text,
					category: "entity_sidebar_follow_up",
					extraParams: {
						context: state.follow_up_context,
						entity_name: state.entity_name,
						entity_category: state.category
					},
					event_name: "sidebar_people_also_ask_clicked",
					statsig_event_name: "sidebar_people_also_ask_clicked",
					event_data: {
						category: state.category,
						widget_name: "sidebar_people_also_ask",
						widget_affordance: "OPTION",
						widget_action_target: "follow_up",
						widget_action_value: suggestion.prompt_text,
						surface_location: "SIDEBAR",
						content_reference_type: "sidebar_people_also_ask"
					}
				}
			})
		}, /* @__PURE__ */ __dil.jsx("text", {
			inline: true,
			size: "lg"
		}, /* @__PURE__ */ __dil.jsx("icon", {
			inline: true,
			name: "arrow-curved"
		}), " ", /* @__PURE__ */ __dil.jsx("text", {
			inline: true,
			underline: "dotted"
		}, suggestion.prompt_text_first_word), /* @__PURE__ */ __dil.jsx("text", {
			inline: true,
			underline: "dotted"
		}, suggestion.prompt_text_after_first_word === "" ? "" : \` \${suggestion.prompt_text_after_first_word}\`))))))))));
	}

//#endregion
return SidebarPeopleAlsoAsk;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=sidebar-people-also-ask-93cb893fbbb1.js.map