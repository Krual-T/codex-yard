import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";var t;function n(){return(n=e((()=>{t=`(() => {
var __dilDefaultExport = (function() {


//#region internal/UnitConverter.dil.tsx
	function significantFigures(value, digits, roundTiny) {
		if (!Number.isFinite(value)) return "";
		if (value === 0 || roundTiny && Math.abs(value) < 10 ** -digits) return "0";
		const factor = 10 ** (digits - Math.floor(Math.log10(Math.abs(value))) - 1);
		const formatted = (Math.round(value * factor) / factor).toPrecision(digits);
		return formatted.includes("e") ? formatted.replace(/(\\.\\d*?)0+e/, "$1e").replace(/\\.e/, "e") : formatted.replace(/(\\.\\d*?)0+$/, "$1").replace(/\\.$/, "");
	}
	function UnitConverter({ state, significant }) {
		const category = state.categories_map[state.category];
		const coefficients = state.conversion_coefficients;
		const editable = category.options_list.every((unit) => coefficients?.[unit]);
		const sourceKey = JSON.stringify([
			state.category,
			state.top_unit,
			state.bottom_unit,
			state.top_amount,
			state.bottom_amount
		]);
		const initialValues = {
			sourceKey,
			top_amount: state.top_amount,
			bottom_amount: state.bottom_amount,
			top_unit: state.top_unit,
			bottom_unit: state.bottom_unit,
			topDraft: null,
			bottomDraft: null
		};
		const values = DIL.useRef(initialValues);
		const [, setRevision] = DIL.useState(0);
		if (values.current.sourceKey !== sourceKey) values.current = initialValues;
		function formatAmount(amount) {
			return significant ? significantFigures(amount, state.significant_digits ?? 8, state.round_tiny_nonzero_to_zero ?? false) : String(Math.round(amount * 1e7) / 1e7);
		}
		function convert(amount, fromUnit, toUnit) {
			if (fromUnit === toUnit) return amount;
			const from = coefficients[fromUnit];
			const to = coefficients[toUnit];
			return ((amount + from.intercept / from.slope) * from.slope - to.intercept) / to.slope;
		}
		function logInteraction(side, unit) {
			if (significant) return;
			GenUI.dispatchAction({
				type: "log_event",
				handler: "client",
				payload: {
					event_name: "chatgpt_widget_action",
					event_data: {
						widget_affordance: unit === void 0 ? "VALUE_INPUT" : "OPTION",
						widget_action_target: \`\${side}_\${unit === void 0 ? "value" : "unit"}\`,
						...unit === void 0 ? {} : { widget_action_value: unit },
						surface_location: "RESPONSE",
						content_reference_type: "unit_converter"
					}
				}
			});
		}
		function changeAmount(side, value) {
			if (!editable) return;
			logInteraction(side);
			const complete = significant ? /^[+-]?(\\d+(\\.\\d*)?|\\.\\d+)([eE][+-]?\\d+)?$/.test(value) : /^[+-]?(\\d+(\\.\\d*)?|\\.\\d+)$/.test(value);
			const incomplete = /^[+-]?\\.?$/.test(value) || significant && /^[+-]?(\\d+(\\.\\d*)?|\\.\\d+)[eE][+-]?$/.test(value);
			if (!complete && !incomplete) return;
			const current = { ...values.current };
			const opposite = side === "top" ? "bottom" : "top";
			current[\`\${side}Draft\`] = value;
			if (!significant && value === "") {
				current.top_amount = 0;
				current.bottom_amount = 0;
				current[\`\${opposite}Draft\`] = null;
			} else if (complete) {
				const amount = Number(value);
				const converted = convert(amount, current[\`\${side}_unit\`], current[\`\${opposite}_unit\`]);
				if (Number.isFinite(amount) && Number.isFinite(converted)) {
					current[\`\${side}_amount\`] = amount;
					current[\`\${opposite}_amount\`] = converted;
					current[\`\${opposite}Draft\`] = null;
				}
			}
			values.current = current;
			setRevision((revision) => revision + 1);
		}
		function changeUnit(side, unit) {
			if (!editable || !coefficients?.[unit]) return;
			const current = { ...values.current };
			const opposite = side === "top" ? "bottom" : "top";
			const converted = convert(current[\`\${opposite}_amount\`], current[\`\${opposite}_unit\`], unit);
			if (!Number.isFinite(converted)) return;
			current[\`\${side}_unit\`] = unit;
			current[\`\${side}_amount\`] = converted;
			current.topDraft = null;
			current.bottomDraft = null;
			values.current = current;
			setRevision((revision) => revision + 1);
			logInteraction(side, unit);
		}
		const options = category.options_list.map((value) => ({
			value,
			label: category.options_names[value]
		}));
		return /* @__PURE__ */ __dil.jsx("card", {
			size: "full",
			variant: "soft",
			background: "transparent",
			radius: 0,
			padding: 0
		}, /* @__PURE__ */ __dil.jsx("col", null, ["top", "bottom"].map((side, index) => /* @__PURE__ */ __dil.jsx("col", { key: side }, index > 0 && /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			padding: { top: -10 }
		}, /* @__PURE__ */ __dil.jsx("col", { flex: 1 }, /* @__PURE__ */ __dil.jsx("divider", { spacing: 2 }))), /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			padding: { left: 2 }
		}, editable ? /* @__PURE__ */ __dil.jsx("box", {
			flex: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("input", {
			variant: "plain",
			inputType: "text",
			fontSize: "fill",
			size: "md",
			pill: false,
			value: values.current[\`\${side}Draft\`] ?? formatAmount(values.current[\`\${side}_amount\`]),
			onChange: (value) => changeAmount(side, value)
		})) : /* @__PURE__ */ __dil.jsx("title", {
			size: "xl",
			tabularNums: true,
			weight: "normal"
		}, formatAmount(state[\`\${side}_amount\`]))), /* @__PURE__ */ __dil.jsx("row", { align: "center" }, /* @__PURE__ */ __dil.jsx("select", {
			variant: "ghost",
			size: "sm",
			value: values.current[\`\${side}_unit\`],
			options,
			disabled: !editable,
			onChange: (value) => changeUnit(side, value)
		}))))));
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
//#region UnitConverterWidget.dil.tsx
	function UnitConverterWidget(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("UnitConverterWidget", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 240
		});
		return /* @__PURE__ */ __dil.jsx(UnitConverter, {
			state,
			significant: false
		});
	}

//#endregion
return UnitConverterWidget;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=unit-converter-widget-9e826eeac702.js.map