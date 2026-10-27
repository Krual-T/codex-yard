import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";var t;function n(){return(n=e((()=>{t=`(() => {
var __dilDefaultExport = (function() {


//#region internal/onboarding-wave2.dil.tsx
	function OnboardingTabs({ items, selected, useCase, source, onChange }) {
		return /* @__PURE__ */ __dil.jsx("row", {
			gap: 2,
			wrap: "wrap",
			width: "100%"
		}, items.map((item) => /* @__PURE__ */ __dil.jsx("button", {
			key: item.id,
			color: "primary",
			size: "lg",
			pill: true,
			variant: selected === item.id ? "solid" : "outline",
			onClick: () => {
				onChange(item.id);
				GenUI.dispatchAction({
					handler: "client",
					type: "log_event",
					loadingBehavior: "none",
					payload: {
						event_name: "chatgpt_conversational_onboarding_tab_clicked",
						event_data: {
							renderer: "dil",
							level: "l2",
							use_case: useCase,
							source,
							tab_id: item.id,
							previous_tab_id: selected
						}
					}
				});
			}
		}, item.label)));
	}
	function OnboardingQuestion({ label, question, gap = 1 }) {
		return /* @__PURE__ */ __dil.jsx("col", {
			gap,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			color: "secondary"
		}, label), /* @__PURE__ */ __dil.jsx("text", {
			size: "lg",
			weight: "semibold"
		}, \`"\${question}"\`));
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
//#region ConversationalOnboardingAdvice.dil.tsx
	function ResolvedAdvice({ state }) {
		const [tab, setTab] = DIL.useState(state.tab);
		return /* @__PURE__ */ __dil.jsx("col", {
			gap: 2,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx(OnboardingTabs, {
			items: [
				{
					id: "step_by_step",
					label: state.everyday_fixes_label
				},
				{
					id: "recipe",
					label: state.recipe_tab_label
				},
				{
					id: "quick_fix",
					label: state.troubleshooting_tab_label
				}
			],
			selected: tab,
			onChange: setTab,
			useCase: "how_to",
			source: "conversational_onboarding_interactive_how_to"
		}), /* @__PURE__ */ __dil.jsx("col", {
			gap: 3,
			padding: { y: 4 },
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx(OnboardingQuestion, {
			label: state.ask_me_label,
			question: tab === "step_by_step" ? state.plant_question : tab === "recipe" ? state.recipe_question : state.troubleshooting_question
		}), tab === "step_by_step" && /* @__PURE__ */ __dil.jsx("row", {
			width: "100%",
			justify: "start"
		}, /* @__PURE__ */ __dil.jsx("image", {
			src: "https://persistent.oaistatic.com/chatgpt/starter_prompts/input_based_examples/plant_example.png",
			alt: state.plant_image_alt,
			width: 220,
			height: 180,
			fit: "cover",
			radius: "xl",
			hideOnFailure: true
		})), tab !== "recipe" && /* @__PURE__ */ __dil.jsx("divider", null), tab === "step_by_step" ? /* @__PURE__ */ __dil.jsx("col", {
			gap: 3,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "lg",
			weight: "semibold"
		}, state.plant_answer_title), /* @__PURE__ */ __dil.jsx("text", null, state.plant_diagnosis), /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, state.plant_care_steps.map((step, index) => /* @__PURE__ */ __dil.jsx("box", { key: index }, /* @__PURE__ */ __dil.jsx("text", null, \`\${index + 1}. \${step}\`))))) : tab === "recipe" ? /* @__PURE__ */ __dil.jsx("col", {
			gap: 0,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("divider", {
			flush: true,
			color: "default",
			size: 1,
			spacing: 0
		}), /* @__PURE__ */ __dil.jsx("col", {
			padding: {
				x: 0,
				top: 4.5,
				bottom: 2.75
			},
			gap: 1.75,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary",
			weight: "semibold"
		}, state.recipe_tab_label), /* @__PURE__ */ __dil.jsx("title", {
			size: "xl",
			weight: "semibold",
			color: "primary",
			width: "100%"
		}, state.recipe_name)), /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			padding: {
				x: 0,
				top: 2.75,
				bottom: 4
			}
		}, /* @__PURE__ */ __dil.jsx("text-only-markdown", { whiteSpace: "normal" }, state.recipe_content)), /* @__PURE__ */ __dil.jsx("divider", {
			flush: true,
			color: "default",
			size: 1,
			spacing: 0
		})) : /* @__PURE__ */ __dil.jsx("col", {
			gap: 3,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "lg",
			weight: "semibold"
		}, state.troubleshooting_title), /* @__PURE__ */ __dil.jsx("text", null, state.troubleshooting_diagnostic_question), /* @__PURE__ */ __dil.jsx("text", null, state.troubleshooting_next_step))));
	}
	function ConversationalOnboardingAdvice(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("ConversationalOnboardingAdvice", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 420
		});
		return /* @__PURE__ */ __dil.jsx(ResolvedAdvice, { state });
	}

//#endregion
return ConversationalOnboardingAdvice;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=conversational-onboarding-advice-2ae27e9b657e.js.map