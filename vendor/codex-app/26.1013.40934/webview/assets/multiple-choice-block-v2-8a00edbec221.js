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
//#region MultipleChoiceBlockV2.dil.tsx
	function MultipleChoiceView({ state }) {
		const [selection, setSelection] = DIL.useState({
			value: state.selected_value,
			status: state.feedback_status,
			open: state.feedback_open,
			hint: state.hint_text,
			error: state.error_message
		});
		DIL.useEffect(() => {
			setSelection({
				value: state.selected_value,
				status: state.feedback_status,
				open: state.feedback_open,
				hint: state.hint_text,
				error: state.error_message
			});
		}, [
			state.selected_value,
			state.feedback_status,
			state.feedback_open,
			state.hint_text,
			state.error_message
		]);
		return /* @__PURE__ */ __dil.jsx("card", { size: "full" }, /* @__PURE__ */ __dil.jsx("col", { gap: 2 }, state.options.map((option) => {
			const selected = selection.value === option.value;
			const status = selected ? selection.status : void 0;
			const color = status === "correct" ? "success" : status === "incorrect" ? "danger" : "primary";
			return /* @__PURE__ */ __dil.jsx("pressable", {
				key: option.value,
				width: "100%",
				padding: {
					x: 3,
					y: 2
				},
				radius: "lg",
				ariaLabel: option.label,
				background: status === "correct" ? {
					light: "green-50",
					dark: "green-a75"
				} : status === "incorrect" ? {
					light: "red-a50",
					dark: "red-a75"
				} : selected ? {
					light: "rgba(0,0,0,0.04)",
					dark: "rgba(255,255,255,0.06)"
				} : "transparent",
				border: {
					size: 1,
					color: status === "correct" ? {
						light: "green-a50",
						dark: "green-a75"
					} : status === "incorrect" ? {
						light: "red-a50",
						dark: "red-a75"
					} : {
						light: "rgba(0,0,0,0.06)",
						dark: "rgba(255,255,255,0.08)"
					}
				},
				onClick: () => {
					if (state.correct_value) {
						setSelection({
							value: option.value,
							status: state.correct_value === option.value ? "correct" : "incorrect",
							open: state.correct_value !== option.value,
							hint: "",
							error: ""
						});
						GenUI.dispatchAction({
							handler: "server",
							type: "multiple_choice_block_v2_check",
							payload: {
								selected_value: option.value,
								selected_label: option.label
							}
						});
					} else GenUI.dispatchAction({
						handler: "client",
						type: "issue_new_turn",
						payload: { query: option.submission_query }
					});
				}
			}, /* @__PURE__ */ __dil.jsx("col", {
				gap: 0,
				width: "100%"
			}, /* @__PURE__ */ __dil.jsx("row", {
				align: "center",
				justify: "between",
				gap: 2,
				width: "100%"
			}, /* @__PURE__ */ __dil.jsx("col", {
				flex: 1,
				gap: 0
			}, /* @__PURE__ */ __dil.jsx("text", {
				textAlign: "start",
				size: "sm"
			}, option.label)), selected && status && /* @__PURE__ */ __dil.jsx("box", {
				size: 24,
				radius: "full",
				align: "center",
				justify: "center",
				background: status === "correct" ? "success-surface" : "danger-surface"
			}, /* @__PURE__ */ __dil.jsx("icon", {
				name: status === "correct" ? "check-lg" : "close-bold",
				size: "md",
				color
			}))), selected && selection.open && (selection.error ? /* @__PURE__ */ __dil.jsx("text", {
				size: "sm",
				color: "danger"
			}, selection.error) : selection.hint ? /* @__PURE__ */ __dil.jsx("text", {
				size: "sm",
				color: "secondary"
			}, selection.hint) : null)));
		})));
	}
	function MultipleChoiceBlockV2(props) {
		const { resolutionComplete, state } = useResolvedComponentResult("MultipleChoiceBlockV2", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 180
		});
		return /* @__PURE__ */ __dil.jsx(MultipleChoiceView, { state });
	}

//#endregion
return MultipleChoiceBlockV2;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=multiple-choice-block-v2-8a00edbec221.js.map