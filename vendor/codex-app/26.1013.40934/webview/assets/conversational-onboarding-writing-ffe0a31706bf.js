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
//#region ConversationalOnboardingWriting.dil.tsx
	function ResolvedWriting({ state }) {
		const [tab, setTab] = DIL.useState(state.tab);
		return /* @__PURE__ */ __dil.jsx("col", {
			gap: 2,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx(OnboardingTabs, {
			items: [
				{
					id: "translation",
					label: state.translation_tab_label
				},
				{
					id: "professional_email",
					label: state.email_tab_label
				},
				{
					id: "birthday_message",
					label: state.message_tab_label
				}
			],
			selected: tab,
			onChange: setTab,
			useCase: "write",
			source: "conversational_onboarding_interactive_write"
		}), /* @__PURE__ */ __dil.jsx("col", {
			gap: 2,
			padding: { y: 2 },
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx(OnboardingQuestion, {
			label: state.ask_me_label,
			gap: 0,
			question: tab === "translation" ? state.translation_question : tab === "professional_email" ? state.email_question : state.message_question
		}), /* @__PURE__ */ __dil.jsx("divider", null), tab === "translation" ? /* @__PURE__ */ __dil.jsx("col", {
			gap: 1,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary",
			preserveWhitespace: true
		}, state.translation.source_text), /* @__PURE__ */ __dil.jsx("text", {
			size: "lg",
			preserveWhitespace: true
		}, state.translation.translated_text)) : tab === "professional_email" ? /* @__PURE__ */ __dil.jsx("col", {
			gap: 2,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			weight: "semibold"
		}, state.email.subject), /* @__PURE__ */ __dil.jsx(TextOnlyMarkdown, null, state.email.content)) : /* @__PURE__ */ __dil.jsx(TextOnlyMarkdown, null, state.message.content)));
	}
	function ConversationalOnboardingWriting(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("ConversationalOnboardingWriting", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 220
		});
		return /* @__PURE__ */ __dil.jsx(ResolvedWriting, { state });
	}

//#endregion
return ConversationalOnboardingWriting;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=conversational-onboarding-writing-ffe0a31706bf.js.map