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
	function ResolvedClinicalScorecard({ state, score, isFieldVisible: isFieldVisible$1 }) {
		const [activeInfoSection, setActiveInfoSection] = DIL.useState(state.active_info_section);
		const [values, setValues] = DIL.useState(state.values);
		const result = score(values);
		const summary = \`\${state.summary_prefix}: \${state.score_label} = \${result.displayScore}; \${result.detail}\`;
		const visibleFields = state.inputs.filter((field) => isFieldVisible$1 ? isFieldVisible$1(field.key, values) : true);
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
	function ClinicalScorecard({ componentName, widgetProps, score, isFieldVisible: isFieldVisible$1 }) {
		const { state, resolutionComplete } = useResolvedComponentResult(componentName, widgetProps);
		if (!state) return resolutionComplete ? widgetProps.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 320
		});
		return /* @__PURE__ */ __dil.jsx(ResolvedClinicalScorecard, {
			key: JSON.stringify(state),
			state,
			score,
			isFieldVisible: isFieldVisible$1
		});
	}

//#endregion
//#region internal/clinical-scorers/calculator_apache_ii_score.dil.ts
	function isFieldVisible(fieldKey, values) {
		if (fieldKey === "pao2") return values.oxygenation_mode === "pao2";
		if (fieldKey === "aado2") return values.oxygenation_mode === "aado2";
		if (fieldKey === "arterial_ph") return values.acid_base_mode === "ph";
		if (fieldKey === "bicarbonate") return values.acid_base_mode === "bicarb";
		return true;
	}
	const scoreClinical = (values) => {
		if ([
			"temperature",
			"map",
			"heart_rate",
			"resp_rate",
			"sodium",
			"potassium",
			"creatinine",
			"hematocrit",
			"wbc",
			"gcs",
			"age",
			values.oxygenation_mode === "aado2" ? "aado2" : "pao2",
			values.acid_base_mode === "ph" ? "arterial_ph" : "bicarbonate"
		].some((key) => values[key] === "")) return {
			displayScore: "-",
			band: "Incomplete",
			detail: "Enter all physiologic variables, age, and GCS to finish the APACHE II calculation.",
			color: "secondary"
		};
		const temperature = Number(values.temperature);
		const map = Number(values.map);
		const heartRate = Number(values.heart_rate);
		const respRate = Number(values.resp_rate);
		const aado2 = Number(values.aado2);
		const pao2 = Number(values.pao2);
		const ph = Number(values.arterial_ph);
		const bicarbonate = Number(values.bicarbonate);
		const sodium = Number(values.sodium);
		const potassium = Number(values.potassium);
		const creatinine = Number(values.creatinine);
		const hematocrit = Number(values.hematocrit);
		const wbc = Number(values.wbc);
		const age = Number(values.age);
		const temperaturePoints = temperature >= 41 ? 4 : temperature >= 39 ? 3 : temperature >= 38.5 ? 1 : temperature >= 36 ? 0 : temperature >= 34 ? 1 : temperature >= 32 ? 2 : temperature >= 30 ? 3 : 4;
		const mapPoints = map >= 160 ? 4 : map >= 130 ? 3 : map >= 110 ? 2 : map >= 70 ? 0 : map >= 50 ? 2 : 4;
		const heartRatePoints = heartRate >= 180 ? 4 : heartRate >= 140 ? 3 : heartRate >= 110 ? 2 : heartRate >= 70 ? 0 : heartRate >= 55 ? 2 : heartRate >= 40 ? 3 : 4;
		const respRatePoints = respRate >= 50 ? 4 : respRate >= 35 ? 3 : respRate >= 25 ? 1 : respRate >= 12 ? 0 : respRate >= 10 ? 1 : respRate >= 6 ? 2 : 4;
		const oxygenationPoints = values.oxygenation_mode === "aado2" ? aado2 >= 500 ? 4 : aado2 >= 350 ? 3 : aado2 >= 200 ? 2 : 0 : pao2 < 55 ? 4 : pao2 <= 60 ? 3 : pao2 <= 70 ? 1 : 0;
		const acidBasePoints = values.acid_base_mode === "ph" ? ph >= 7.7 ? 4 : ph >= 7.6 ? 3 : ph >= 7.5 ? 1 : ph >= 7.33 ? 0 : ph >= 7.25 ? 2 : ph >= 7.15 ? 3 : 4 : bicarbonate >= 52 ? 4 : bicarbonate >= 41 ? 3 : bicarbonate >= 32 ? 1 : bicarbonate >= 22 ? 0 : bicarbonate >= 18 ? 2 : bicarbonate >= 15 ? 3 : 4;
		const sodiumPoints = sodium >= 180 ? 4 : sodium >= 160 ? 3 : sodium >= 155 ? 2 : sodium >= 150 ? 1 : sodium >= 130 ? 0 : sodium >= 120 ? 2 : sodium >= 111 ? 3 : 4;
		const potassiumPoints = potassium >= 7 ? 4 : potassium >= 6 ? 3 : potassium >= 5.5 ? 1 : potassium >= 3.5 ? 0 : potassium >= 3 ? 1 : potassium >= 2.5 ? 2 : 4;
		const creatininePoints = (creatinine >= 3.5 ? 4 : creatinine >= 2 ? 3 : creatinine >= 1.5 ? 2 : creatinine >= .6 ? 0 : 2) * (values.acute_renal_failure === "1" ? 2 : 1);
		const hematocritPoints = hematocrit >= 60 ? 4 : hematocrit >= 50 ? 2 : hematocrit >= 46 ? 1 : hematocrit >= 30 ? 0 : hematocrit >= 20 ? 2 : 4;
		const wbcPoints = wbc >= 40 ? 4 : wbc >= 20 ? 2 : wbc >= 15 ? 1 : wbc >= 3 ? 0 : wbc >= 1 ? 2 : 4;
		const agePoints = age >= 75 ? 6 : age >= 65 ? 5 : age >= 55 ? 3 : age >= 45 ? 2 : 0;
		const score = Math.trunc(temperaturePoints + mapPoints + heartRatePoints + respRatePoints + oxygenationPoints + acidBasePoints + sodiumPoints + potassiumPoints + creatininePoints + hematocritPoints + wbcPoints + (15 - Number(values.gcs)) + agePoints + Number(values.chronic_health_points));
		return {
			displayScore: String(score),
			band: score <= 9 ? "Lower mortality band" : score <= 19 ? "Intermediate mortality band" : score <= 29 ? "High mortality band" : "Very high mortality band",
			detail: score <= 4 ? "Approximate in-hospital mortality about 4%." : score <= 9 ? "Approximate in-hospital mortality about 8%." : score <= 14 ? "Approximate in-hospital mortality about 15%." : score <= 19 ? "Approximate in-hospital mortality about 25%." : score <= 24 ? "Approximate in-hospital mortality about 40%." : score <= 29 ? "Approximate in-hospital mortality about 55%." : score <= 34 ? "Approximate in-hospital mortality about 75%." : "Approximate in-hospital mortality about 85% or higher.",
			color: score <= 9 ? "success" : score <= 19 ? "warning" : "danger"
		};
	};

//#endregion
//#region CalculatorApacheIiScoreWidget.dil.tsx
	function CalculatorApacheIiScoreWidget(props) {
		return /* @__PURE__ */ __dil.jsx(ClinicalScorecard, {
			componentName: "CalculatorApacheIiScoreWidget",
			widgetProps: props,
			score: scoreClinical,
			isFieldVisible
		});
	}

//#endregion
return CalculatorApacheIiScoreWidget;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=calculator-apache-ii-score-widget-84c91eb1501e.js.map