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
//#region FollowUpQuiz.dil.tsx
	function FollowUpQuiz(props) {
		const { resolutionComplete, state } = useResolvedComponentResult("FollowUpQuiz", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 160
		});
		return /* @__PURE__ */ __dil.jsx(ResolvedFollowUpQuiz, { state });
	}
	function QuizAnswer({ label, checked, disabled, onChange }) {
		return /* @__PURE__ */ __dil.jsx("checkbox", {
			label,
			shape: "square",
			lineThrough: false,
			checked,
			disabled,
			onChange
		});
	}
	function ResolvedFollowUpQuiz({ state }) {
		const [currentIndex, setCurrentIndex] = DIL.useState(state.current_index ?? 0);
		const [answers, setAnswers] = DIL.useState(state.answers ?? []);
		const currentQuestion = state.questions[currentIndex];
		return /* @__PURE__ */ __dil.jsx("card", { size: "full" }, /* @__PURE__ */ __dil.jsx("col", { gap: 3 }, state.title !== "" ? /* @__PURE__ */ __dil.jsx("caption", {
			size: "lg",
			color: "secondary"
		}, state.title) : null, state.questions.length > 0 ? /* @__PURE__ */ __dil.jsx("col", { gap: 3 }, currentQuestion ? /* @__PURE__ */ __dil.jsx("col", { gap: 2 }, currentQuestion.answers.map((answer, index) => /* @__PURE__ */ __dil.jsx(QuizAnswer, {
			key: index,
			label: answer,
			checked: answers.some((saved) => saved.index === currentIndex && saved.answer === answer),
			disabled: answers.some((saved) => saved.index === currentIndex),
			onChange: (checked) => {
				if (checked) {
					setAnswers([...answers, {
						index: currentIndex,
						question: currentQuestion.question,
						answer
					}]);
					setCurrentIndex(currentIndex + 1);
				}
			}
		}))) : null, /* @__PURE__ */ __dil.jsx("row", {
			justify: "between",
			align: "center",
			gap: 2
		}, /* @__PURE__ */ __dil.jsx("button", {
			size: "sm",
			color: "secondary",
			disabled: currentIndex >= state.questions.length,
			onClick: () => {
				if (currentIndex < state.questions.length) setCurrentIndex(currentIndex + 1);
			}
		}, "Skip"), /* @__PURE__ */ __dil.jsx("button", {
			size: "sm",
			color: "primary",
			disabled: answers.length === 0,
			onClick: () => GenUI.dispatchAction({
				handler: "client",
				type: "issue_new_turn",
				payload: { query: state.submit_query_prefix + "\\n" + answers.map((answer) => "- " + answer.question + ": " + answer.answer).join("\\n") }
			})
		}, state.submit_label))) : /* @__PURE__ */ __dil.jsx("text", { color: "secondary" }, "No follow-up questions available.")));
	}

//#endregion
return FollowUpQuiz;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=follow-up-quiz-2104a89c51a2.js.map