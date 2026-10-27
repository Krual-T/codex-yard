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
//#region internal/clinical-scorecards.dil.tsx
	function ClinicalControl({ field, value, onChange }) {
		if (field.control === "checkbox") return /* @__PURE__ */ __dil.jsx("box", { padding: { x: 2 } }, /* @__PURE__ */ __dil.jsx("segmented-control", {
			options: [{
				value: field.unchecked_value,
				label: field.unchecked_label
			}, {
				value: field.checked_value,
				label: field.checked_label
			}],
			value,
			onChange,
			block: true,
			size: "md"
		}));
		if (field.control === "select") {
			const options = field.options.map((option) => ({
				value: option.value,
				label: option.label
			}));
			return field.select_variant === "segmented" ? /* @__PURE__ */ __dil.jsx("box", { padding: { x: 2 } }, /* @__PURE__ */ __dil.jsx("segmented-control", {
				options,
				value,
				onChange,
				block: true,
				size: "md"
			})) : /* @__PURE__ */ __dil.jsx("select", {
				ariaLabel: field.label,
				options,
				value,
				placeholder: field.placeholder,
				onChange
			});
		}
		return /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 0
		}, /* @__PURE__ */ __dil.jsx("box", { flex: 1 }, /* @__PURE__ */ __dil.jsx("input", {
			value,
			placeholder: field.placeholder,
			inputType: field.input_type,
			onChange
		})), field.suffix !== "" && /* @__PURE__ */ __dil.jsx("box", {
			padding: {
				x: 3,
				y: 2.5
			},
			background: "surface-primary",
			border: {
				size: 1,
				color: "subtle"
			},
			radius: "md"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, field.suffix)));
	}
	function ClinicalCriterion({ field, value, onChange }) {
		const selectedHelp = field.options.find((option) => option.value === value && option.help)?.help;
		return /* @__PURE__ */ __dil.jsx("box", {
			padding: {
				x: 3,
				y: 3
			},
			radius: "xl",
			background: "surface-secondary",
			border: {
				size: 1,
				color: "subtle"
			}
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 3,
			wrap: "wrap"
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: 1.5,
			flex: 1,
			minWidth: 220
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium"
		}, field.label), field.help && /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary",
			preserveWhitespace: true
		}, field.help)), /* @__PURE__ */ __dil.jsx("col", {
			gap: 1.5,
			flex: 1,
			minWidth: 260
		}, /* @__PURE__ */ __dil.jsx(ClinicalControl, {
			field,
			value,
			onChange
		}), selectedHelp && /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary",
			preserveWhitespace: true
		}, selectedHelp))));
	}
	function ResolvedClinicalScorecard({ state, score, isFieldVisible }) {
		const [activeInfoSection, setActiveInfoSection] = DIL.useState(state.active_info_section);
		const [values, setValues] = DIL.useState(state.values);
		const result = score(values);
		const summary = \`\${state.summary_prefix}: \${state.score_label} = \${result.displayScore}; \${result.detail}\`;
		const visibleFields = state.inputs.filter((field) => isFieldVisible ? isFieldVisible(field.key, values) : true);
		return /* @__PURE__ */ __dil.jsx("card", {
			size: "full",
			padding: 0
		}, /* @__PURE__ */ __dil.jsx("col", { gap: 0 }, /* @__PURE__ */ __dil.jsx("col", {
			padding: {
				x: 5,
				y: 4
			},
			background: {
				light: "blue-50",
				dark: "blue-400"
			},
			gap: 2.5
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 2
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: 36,
			height: 4,
			radius: "full",
			background: {
				light: "blue-400",
				dark: "blue-50"
			}
		}), /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary"
		}, "Clinical risk calculator")), /* @__PURE__ */ __dil.jsx("title", {
			size: "xl",
			weight: "medium",
			color: "black"
		}, state.title), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary",
			preserveWhitespace: true
		}, state.subtitle)), /* @__PURE__ */ __dil.jsx("col", {
			gap: 4,
			padding: {
				x: 5,
				y: 5
			}
		}, state.info_sections.length > 0 && /* @__PURE__ */ __dil.jsx("col", { gap: 2 }, /* @__PURE__ */ __dil.jsx("box", { padding: { x: 2 } }, /* @__PURE__ */ __dil.jsx("segmented-control", {
			options: state.info_sections.map((section) => ({
				value: section.key,
				label: section.label
			})),
			value: activeInfoSection,
			onChange: setActiveInfoSection,
			block: true,
			size: "md"
		})), /* @__PURE__ */ __dil.jsx("box", {
			padding: {
				x: 3,
				y: 3
			},
			radius: "xl",
			background: "surface-secondary",
			border: {
				size: 1,
				color: "subtle"
			}
		}, state.info_sections.filter((section) => section.key === activeInfoSection).map((section) => /* @__PURE__ */ __dil.jsx("box", { key: section.key }, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary",
			preserveWhitespace: true
		}, section.body))))), /* @__PURE__ */ __dil.jsx("row", {
			align: "stretch",
			gap: 3,
			wrap: "wrap"
		}, /* @__PURE__ */ __dil.jsx("box", {
			minWidth: 148,
			padding: {
				x: 4,
				y: 4
			},
			radius: "xl",
			background: "surface-secondary"
		}, /* @__PURE__ */ __dil.jsx("col", { gap: 1 }, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, state.score_label), /* @__PURE__ */ __dil.jsx("title", {
			size: "3xl",
			tabularNums: true
		}, result.displayScore), state.score_range_label !== "" && /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, state.score_range_label))), /* @__PURE__ */ __dil.jsx("box", {
			flex: 1,
			minWidth: 220,
			padding: {
				x: 4,
				y: 4
			},
			radius: "xl",
			background: "surface-secondary"
		}, /* @__PURE__ */ __dil.jsx("col", { gap: 2 }, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, state.result_title), /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, result.band !== "" && /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 2,
			wrap: "wrap"
		}, /* @__PURE__ */ __dil.jsx("badge", {
			variant: "soft",
			color: result.color
		}, result.band)), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, result.detail))))), /* @__PURE__ */ __dil.jsx("col", { gap: 2 }, /* @__PURE__ */ __dil.jsx("row", {
			justify: "between",
			align: "center",
			gap: 2,
			wrap: "wrap"
		}, /* @__PURE__ */ __dil.jsx("title", { size: "md" }, "Inputs"), /* @__PURE__ */ __dil.jsx("button", {
			variant: "outline",
			size: "sm",
			onClick: () => setValues(state.defaults)
		}, "Reset")), /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, visibleFields.map((field) => /* @__PURE__ */ __dil.jsx(ClinicalCriterion, {
			key: field.key,
			field,
			value: values[field.key],
			onChange: (value) => setValues({
				...values,
				[field.key]: value
			})
		})))), state.notes.length > 0 && /* @__PURE__ */ __dil.jsx("col", { gap: 2 }, /* @__PURE__ */ __dil.jsx("title", { size: "md" }, "Notes"), /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, state.notes.map((note, index) => /* @__PURE__ */ __dil.jsx("row", {
			key: index,
			align: "start",
			gap: 2
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, "-"), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary",
			preserveWhitespace: true
		}, note))))), /* @__PURE__ */ __dil.jsx("col", { gap: 2 }, /* @__PURE__ */ __dil.jsx("title", { size: "md" }, "Copyable summary"), /* @__PURE__ */ __dil.jsx("box", {
			padding: {
				x: 3,
				y: 3
			},
			radius: "xl",
			background: "surface-secondary",
			border: {
				size: 1,
				color: "subtle"
			}
		}, /* @__PURE__ */ __dil.jsx("text", { size: "sm" }, summary)), /* @__PURE__ */ __dil.jsx("button", {
			variant: "outline",
			size: "sm",
			onClick: () => GenUI.dispatchAction({
				handler: "client",
				type: "copy",
				payload: { value: summary }
			})
		}, "Copy summary")))));
	}
	function ClinicalScorecard({ componentName, widgetProps, score, isFieldVisible }) {
		const { state, resolutionComplete } = useResolvedComponentResult(componentName, widgetProps);
		if (!state) return resolutionComplete ? widgetProps.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 320
		});
		return /* @__PURE__ */ __dil.jsx(ResolvedClinicalScorecard, {
			key: JSON.stringify(state),
			state,
			score,
			isFieldVisible
		});
	}

//#endregion
//#region internal/clinical-scorers/calculator_bishop_score_for_cervical_ripening.dil.ts
	const scoreClinical = (values) => {
		const score = [
			"dilation",
			"effacement",
			"station",
			"consistency",
			"position"
		].reduce((total, key) => total + Number(values[key]), 0);
		return {
			displayScore: String(score),
			band: score <= 5 ? "Unfavorable cervix" : score <= 8 ? "Intermediate favorability" : "Favorable cervix",
			detail: score <= 5 ? "Lower Bishop scores suggest an unfavorable cervix and a higher chance that cervical ripening will be needed." : score <= 8 ? "Intermediate cervical favorability." : "Scores above 8 suggest a favorable cervix with induction success closer to spontaneous labor.",
			color: score <= 5 ? "warning" : score <= 8 ? "warning" : "success"
		};
	};

//#endregion
//#region CalculatorBishopScoreForCervicalRipeningWidget.dil.tsx
	function CalculatorBishopScoreForCervicalRipeningWidget(props) {
		return /* @__PURE__ */ __dil.jsx(ClinicalScorecard, {
			componentName: "CalculatorBishopScoreForCervicalRipeningWidget",
			widgetProps: props,
			score: scoreClinical
		});
	}

//#endregion
return CalculatorBishopScoreForCervicalRipeningWidget;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=calculator-bishop-score-for-cervical-ripening-widget-6353847ff21b.js.map