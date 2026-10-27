import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";var t;function n(){return(n=e((()=>{t=`(() => {
var __dilDefaultExport = (function() {


//#region currency-number.dil.ts
	function numberSymbols(locale) {
		const formatter = new Intl.NumberFormat(locale);
		const parts = formatter.formatToParts(12345.6);
		const digits = {};
		for (let digit = 0; digit < 10; digit += 1) {
			digits[formatter.format(digit)] = String(digit);
			digits[String(digit)] = String(digit);
		}
		return {
			group: parts.find((part) => part.type === "group")?.value ?? ",",
			decimal: parts.find((part) => part.type === "decimal")?.value ?? ".",
			digits
		};
	}
	function parseAmount(value, symbols) {
		if (/[-−]/.test(value.replace(/[eE][-−]/g, ""))) return null;
		let text = "";
		let normalized = "";
		let hasExponent = false;
		let hasDecimal = false;
		for (const character of value) {
			const digit = symbols.digits[character];
			if (digit !== void 0) {
				text += character;
				normalized += digit;
			} else if (character === symbols.group) text += character;
			else if ((character === symbols.decimal || character === "." && symbols.group !== ".") && !hasDecimal) {
				text += character;
				normalized += ".";
				hasDecimal = true;
			} else if (/^[eE]$/.test(character) && !hasExponent) {
				text += character;
				normalized += "e";
				hasExponent = true;
				hasDecimal = false;
			} else if (/^[-−]$/.test(character) && normalized.endsWith("e")) {
				text += character;
				normalized += "-";
			}
		}
		return {
			text,
			amount: normalized ? Number(normalized) : NaN
		};
	}

//#endregion
//#region shared.dil.ts
	function useIsLiveActivity() {
		return DIL.useAppData((appData) => appData.opGenui?.surface === "live-activity");
	}
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
//#region CurrencyConverterV2WidgetWithSource.dil.tsx
	function formatAmount(value, currency) {
		if (!Number.isFinite(value)) return "";
		const options = new Intl.NumberFormat(void 0, {
			style: "currency",
			currency
		}).resolvedOptions();
		return new Intl.NumberFormat(void 0, {
			minimumFractionDigits: options.minimumFractionDigits,
			maximumFractionDigits: options.maximumFractionDigits,
			useGrouping: options.useGrouping
		}).format(value);
	}
	function convertedAmount(value, rate) {
		const converted = value * rate;
		const absolute = Math.abs(converted);
		const digits = absolute >= 1 ? 2 : absolute >= .01 ? 4 : absolute >= 1e-6 ? 6 : null;
		return digits == null ? converted : Math.round(converted * 10 ** digits) / 10 ** digits;
	}
	function CurrencyConverterV2WidgetWithSource(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("CurrencyConverterV2WidgetWithSource", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 250
		});
		return /* @__PURE__ */ __dil.jsx(Converter, { state });
	}
	function Converter({ state }) {
		const isLiveActivity = useIsLiveActivity();
		const symbols = DIL.useMemo(numberSymbols, []);
		const values = DIL.useRef({
			from: formatAmount(state.base_amount, state.from_currency),
			to: formatAmount(convertedAmount(state.base_amount, state.exchange_rate), state.to_currency)
		});
		const [, setRevision] = DIL.useState(0);
		function change(side, value) {
			const trimmed = value.trim();
			const negative = /^[−-]/.test(trimmed);
			const parsed = parseAmount(negative ? trimmed.replace(/^[−-]+/, "") : trimmed, symbols);
			if (!parsed) return;
			const amount = negative ? -parsed.amount : parsed.amount;
			const nextValues = { ...values.current };
			nextValues[side] = \`\${negative ? "-" : ""}\${parsed.text}\`;
			const opposite = side === "from" ? "to" : "from";
			const rate = side === "from" ? state.exchange_rate : state.exchange_rate > 0 ? 1 / state.exchange_rate : 0;
			nextValues[opposite] = side === "to" && state.exchange_rate <= 0 ? "" : formatAmount(convertedAmount(amount, rate), state[\`\${opposite}_currency\`]);
			nextValues.editedAmounts = {
				from: side === "from" ? amount : state.exchange_rate > 0 ? convertedAmount(amount, rate) : NaN,
				to: side === "to" ? amount : convertedAmount(amount, rate)
			};
			values.current = nextValues;
			setRevision((revision) => revision + 1);
		}
		if (isLiveActivity) return /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			padding: 2,
			theme: "dark",
			background: "surface"
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 3,
			width: "100%"
		}, ["from", "to"].map((side, index) => {
			const amount = values.current.editedAmounts?.[side] ?? (side === "from" ? state.base_amount : convertedAmount(state.base_amount, state.exchange_rate));
			return /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, index > 0 && /* @__PURE__ */ __dil.jsx("icon", {
				name: "arrow-curved",
				size: "sm",
				color: "secondary"
			}), /* @__PURE__ */ __dil.jsx("col", {
				key: side,
				gap: 0,
				flex: 1,
				minWidth: 0
			}, /* @__PURE__ */ __dil.jsx("text", {
				size: "xs",
				color: "secondary",
				truncate: true
			}, state[\`\${side}_currency\`]), /* @__PURE__ */ __dil.jsx("title", {
				size: "md",
				weight: "medium",
				truncate: true
			}, Number.isFinite(amount) ? new Intl.NumberFormat(void 0, {
				style: "currency",
				currency: state[\`\${side}_currency\`]
			}).format(amount) : "")));
		})));
		return /* @__PURE__ */ __dil.jsx("card", {
			size: "full",
			variant: "soft",
			background: "transparent",
			radius: 0,
			padding: 0
		}, /* @__PURE__ */ __dil.jsx("col", {
			flex: 1,
			padding: 0
		}, /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, ["from", "to"].map((side, index) => /* @__PURE__ */ __dil.jsx("col", {
			key: side,
			gap: .5
		}, index > 0 && /* @__PURE__ */ __dil.jsx("divider", null), /* @__PURE__ */ __dil.jsx("label", {
			weight: "normal",
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("col", { gap: .5 }, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 1.5
		}, /* @__PURE__ */ __dil.jsx("text", { size: "sm" }, state[\`\${side}_currency_flag\`]), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, state[\`\${side}_currency_display_name\`])), /* @__PURE__ */ __dil.jsx("row", {
			align: "end",
			gap: 1
		}, /* @__PURE__ */ __dil.jsx("col", { padding: { bottom: .5 } }, /* @__PURE__ */ __dil.jsx("text", {
			size: "lg",
			color: "secondary"
		}, state[\`\${side}_currency_symbol\`])), /* @__PURE__ */ __dil.jsx("box", {
			flex: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("input", {
			variant: "plain",
			inputType: "text",
			fontSize: "fill",
			size: "md",
			pill: false,
			value: values.current[side],
			onChange: (value) => change(side, value)
		})))))))), /* @__PURE__ */ __dil.jsx("col", { gap: .25 }, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, state.footer_label))));
	}

//#endregion
return CurrencyConverterV2WidgetWithSource;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=currency-converter-v2-widget-with-source-6b9305956bbe.js.map