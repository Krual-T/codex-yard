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
//#region InstantSuggestionsWidget.dil.tsx
	function InstantSuggestionsWidget(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("InstantSuggestionsWidget", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 160
		});
		if (!state.suggestions.length) return null;
		return /* @__PURE__ */ __dil.jsx("box", {
			direction: "col",
			width: "40rem",
			maxWidth: "100%",
			gap: 0,
			...GenUI.logEvent ? { onVisible: () => GenUI.logEvent?.({
				event_name: "instant_suggestions_widget_shown",
				statsig_event_name: "instant_suggestions_widget_shown",
				event_data: {
					category: state.category,
					widget_name: "instant_suggestions"
				}
			}) } : {}
		}, /* @__PURE__ */ __dil.jsx("box", { padding: {
			top: 4,
			x: 0,
			bottom: 1
		} }, /* @__PURE__ */ __dil.jsx("title", { size: "sm" }, state.title)), /* @__PURE__ */ __dil.jsx("table", null, /* @__PURE__ */ __dil.jsx("table-section", null, state.suggestions.map((suggestion) => /* @__PURE__ */ __dil.jsx("table-row", { key: suggestion.prompt_text }, /* @__PURE__ */ __dil.jsx("table-cell", { padding: { y: 2 } }, /* @__PURE__ */ __dil.jsx("box", { minHeight: 22 }, /* @__PURE__ */ __dil.jsx("pressable", {
			width: "100%",
			padding: 0,
			onClick: () => {
				const hint = suggestion.message_metadata?.instant_answer_hint;
				GenUI.issueNewTurn(suggestion.prompt_text, {
					followup_metadata: typeof hint?.answer_id === "string" && typeof hint.referenced_canonical_entity_id === "string" ? { instant_answer_hint: {
						answer_id: hint.answer_id,
						referenced_canonical_entity_id: hint.referenced_canonical_entity_id
					} } : void 0,
					event_name: "chatgpt_widget_action",
					statsig_event_name: "instant_suggestions_widget_clicked",
					event_data: {
						category: state.category,
						widget_name: "instant_suggestions",
						widget_affordance: "OPTION",
						widget_action_target: "follow_up",
						widget_action_value: suggestion.prompt_text,
						surface_location: "SIDEBAR",
						content_reference_type: "instant_suggestions_widget"
					}
				});
			}
		}, /* @__PURE__ */ __dil.jsx("row", {
			width: "100%",
			minWidth: 0,
			align: "start",
			gap: 2,
			wrap: "nowrap"
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: 20,
			minWidth: 20,
			padding: { top: .5 }
		}, /* @__PURE__ */ __dil.jsx("icon", { name: "arrow-curved" })), /* @__PURE__ */ __dil.jsx("box", {
			flex: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("text", {
			inline: true,
			size: "lg",
			underline: "dotted"
		}, suggestion.prompt_text)))))))))));
	}

//#endregion
return InstantSuggestionsWidget;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=instant-suggestions-widget-7d916f84002f.js.map