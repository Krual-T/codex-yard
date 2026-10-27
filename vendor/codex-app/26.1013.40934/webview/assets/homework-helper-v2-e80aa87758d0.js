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
//#region HomeworkHelperV2.dil.tsx
	function isFollowupChoice(value) {
		return value === "guided" || value === "show_answer" || value === "quiz_me";
	}
	function HomeworkHelperView({ state, componentKey }) {
		const [selectedValue, setSelectedValue] = DIL.useState(state.selected_value);
		const [submitted, setSubmitted] = DIL.useState(state.submitted);
		const submissionLocked = state.prevent_repeated_submission === true && submitted;
		const selectedOption = state.options.find((option) => option.value === selectedValue);
		const disabled = !selectedOption || !isFollowupChoice(selectedValue) && selectedValue !== "voice" || submissionLocked || selectedValue === "voice" && (submitted || state.submitted);
		return /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			border: {
				size: 1,
				color: "default"
			},
			radius: "3xl",
			background: "surface-elevated",
			clip: true
		}, /* @__PURE__ */ __dil.jsx("col", { gap: 0 }, /* @__PURE__ */ __dil.jsx("box", { padding: {
			x: 5,
			top: 5,
			bottom: 3
		} }, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			color: "primary"
		}, state.question)), /* @__PURE__ */ __dil.jsx("col", { gap: 0 }, state.options.map((option, index) => /* @__PURE__ */ __dil.jsx("box", {
			key: option.value,
			gap: 0
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			width: "100%",
			direction: "col",
			padding: 0,
			radius: "none",
			background: selectedValue === option.value ? "surface-secondary" : "transparent",
			ariaLabel: option.label,
			disabled: submissionLocked,
			onClick: () => {
				if (submissionLocked) return;
				GenUI.dispatchAction({
					handler: "server",
					type: "homework_helper_v2_selection",
					payload: { selected_value: option.value }
				});
				setSelectedValue(option.value);
			}
		}, /* @__PURE__ */ __dil.jsx("row", {
			minHeight: 56,
			align: "center",
			gap: 3,
			padding: { x: 5 }
		}, /* @__PURE__ */ __dil.jsx("box", {
			size: 24,
			align: "center",
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("box", {
			size: 20,
			radius: "full",
			align: "center",
			justify: "center",
			background: selectedValue === option.value ? "surface-inverted" : "surface-elevated",
			border: selectedValue === option.value ? 0 : {
				size: 1,
				color: "default"
			}
		}, selectedValue === option.value && /* @__PURE__ */ __dil.jsx("box", {
			size: 8,
			radius: "full",
			background: "surface"
		}))), /* @__PURE__ */ __dil.jsx("col", {
			flex: 1,
			gap: 0
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "primary"
		}, option.label)))), index + 1 < state.options.length && /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			height: 1,
			background: "border-subtle"
		})))), /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			height: 60,
			padding: { x: 5 }
		}, /* @__PURE__ */ __dil.jsx("spacer", null), /* @__PURE__ */ __dil.jsx("box", {
			width: "fit-content",
			background: disabled ? "alpha-05" : void 0,
			radius: "full"
		}, /* @__PURE__ */ __dil.jsx("button", {
			color: "primary",
			variant: "outline",
			size: "lg",
			pill: true,
			disabled,
			onClick: () => {
				if (!selectedOption || disabled) return;
				if (state.prevent_repeated_submission || selectedValue === "voice") setSubmitted(true);
				const event_data = {
					widget_affordance: "OPTION",
					widget_action_target: "learning_mode_submit",
					widget_action_value: selectedValue,
					surface_location: "RESPONSE",
					content_reference_type: "homework_helper_v2"
				};
				if (selectedValue === "voice") GenUI.dispatchAction({
					type: "start_voice_mode",
					handler: "client",
					payload: {
						component_key: componentKey,
						event_source: "homework_helper_v2_widget",
						event_name: "chatgpt_widget_action",
						event_data
					}
				});
				else GenUI.issueNewTurn(selectedOption.label, {
					append_to_current_leaf: true,
					followup_metadata: { homework_helper_v2_choice: selectedValue },
					event_name: "chatgpt_widget_action",
					event_data
				});
			}
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			color: disabled ? "tertiary" : "primary"
		}, state.submit_label))))));
	}
	function HomeworkHelperV2(props) {
		const componentKey = DIL.useAppData((appData) => typeof props.__resolutionId === "string" && appData.opGenui?.componentResults?.[props.__resolutionId] != null ? props.__resolutionId : componentDataKey("HomeworkHelperV2", props));
		const { resolutionComplete, state } = useResolvedComponentResult("HomeworkHelperV2", {
			...props,
			__resolutionId: componentKey,
			__state: void 0
		});
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 280
		});
		return /* @__PURE__ */ __dil.jsx(HomeworkHelperView, {
			state,
			componentKey
		});
	}

//#endregion
return HomeworkHelperV2;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=homework-helper-v2-e80aa87758d0.js.map