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
//#region CurrencyConverterWidgetWithSource.dil.tsx
	function decimalParts(value) {
		const match = /^(-?)(\\d+)(?:\\.(\\d+))?(?:e([+-]?\\d+))?$/i.exec(String(value));
		if (!match) return null;
		const [, sign, integer, fraction = "", exponent = "0"] = match;
		let coefficient = BigInt(\`\${sign}\${integer}\${fraction}\`);
		let scale = fraction.length - Number(exponent);
		if (scale < 0) {
			coefficient *= 10n ** BigInt(-scale);
			scale = 0;
		}
		return {
			coefficient,
			scale
		};
	}
	function currencyProduct(left, right) {
		const product = left * right;
		if (!Number.isFinite(product) || product === 0) return product;
		const a = decimalParts(left);
		const b = decimalParts(right);
		return a && b ? Number(\`\${a.coefficient * b.coefficient}e\${-(a.scale + b.scale)}\`) : product;
	}
	function currencyQuotient(left, right) {
		const quotient = left / right;
		if (!Number.isFinite(quotient) || quotient === 0) return quotient;
		const a = decimalParts(left);
		const b = decimalParts(right);
		if (!a || !b || b.coefficient === 0n) return quotient;
		let numerator = a.coefficient * 10n ** BigInt(b.scale);
		let denominator = b.coefficient * 10n ** BigInt(a.scale);
		let divisor = numerator;
		let remainder = denominator;
		while (remainder !== 0n) [divisor, remainder] = [remainder, divisor % remainder];
		numerator /= divisor;
		denominator /= divisor;
		let twos = 0;
		let fives = 0;
		while (denominator % 2n === 0n) {
			denominator /= 2n;
			twos += 1;
		}
		while (denominator % 5n === 0n) {
			denominator /= 5n;
			fives += 1;
		}
		if (denominator !== 1n) return quotient;
		const scale = Math.max(twos, fives);
		numerator *= 2n ** BigInt(scale - twos) * 5n ** BigInt(scale - fives);
		return Number(\`\${numerator}e\${-scale}\`);
	}
	function formatAmount(value, currency, directInput) {
		if (!Number.isFinite(value)) return "";
		const currencyOptions = new Intl.NumberFormat(void 0, {
			style: "currency",
			currency
		}).resolvedOptions();
		const fractionDigits = currencyOptions.maximumFractionDigits ?? 0;
		const precision = directInput ? { maximumSignificantDigits: 17 } : value > 0 && value < 10 ** -fractionDigits ? { maximumSignificantDigits: 2 } : {
			minimumFractionDigits: currencyOptions.minimumFractionDigits,
			maximumFractionDigits: fractionDigits
		};
		return new Intl.NumberFormat(void 0, {
			...precision,
			useGrouping: currencyOptions.useGrouping
		}).format(value);
	}
	function flagLabel(flag) {
		return /^[a-z]{2}$/i.test(flag) ? flag.toUpperCase().split("").map((letter) => String.fromCodePoint(letter.charCodeAt(0) + 127397)).join("") : flag;
	}
	function ResolvedCurrencyConverter({ state }) {
		const symbols = DIL.useMemo(numberSymbols, []);
		const [, setRevision] = DIL.useState(0);
		const values = DIL.useRef({
			from: state.base_amount,
			to: currencyProduct(state.base_amount, state.exchange_rate),
			direct: "from",
			fromDraft: null,
			toDraft: null
		});
		function changeAmount(side, value) {
			const parsed = parseAmount(value, symbols);
			if (parsed === null) return;
			const opposite = side === "from" ? "to" : "from";
			const converted = side === "from" ? currencyProduct(parsed.amount, state.exchange_rate) : currencyQuotient(parsed.amount, state.exchange_rate);
			const nextValues = { ...values.current };
			nextValues[\`\${side}Draft\`] = parsed.text;
			if (Number.isFinite(parsed.amount) && parsed.amount >= 0 && Number.isFinite(converted)) {
				nextValues[side] = parsed.amount;
				nextValues[opposite] = converted;
				nextValues.direct = side;
				nextValues[\`\${opposite}Draft\`] = null;
			}
			values.current = nextValues;
			setRevision((revision) => revision + 1);
			GenUI.dispatchAction({
				type: "log_event",
				handler: "client",
				payload: {
					event_name: "chatgpt_widget_action",
					event_data: {
						widget_affordance: "VALUE_INPUT",
						widget_action_target: \`\${side}_amount\`,
						surface_location: "RESPONSE",
						content_reference_type: "currency_converter"
					}
				}
			});
		}
		return /* @__PURE__ */ __dil.jsx("card", {
			size: "full",
			variant: "soft",
			background: "transparent",
			radius: 0,
			padding: 0
		}, /* @__PURE__ */ __dil.jsx("col", { gap: 4 }, ["from", "to"].map((side, index) => /* @__PURE__ */ __dil.jsx("col", {
			key: side,
			gap: 4
		}, index > 0 ? /* @__PURE__ */ __dil.jsx("divider", null) : null, /* @__PURE__ */ __dil.jsx("label", {
			width: "100%",
			weight: "normal"
		}, /* @__PURE__ */ __dil.jsx("col", { gap: .5 }, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 1.5
		}, /* @__PURE__ */ __dil.jsx("text", { size: "sm" }, flagLabel(state[\`\${side}_currency_flag\`])), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, state[\`\${side}_currency_display_name\`])), /* @__PURE__ */ __dil.jsx("row", {
			align: "end",
			gap: 1
		}, /* @__PURE__ */ __dil.jsx("box", { padding: { bottom: .5 } }, /* @__PURE__ */ __dil.jsx("text", {
			size: "lg",
			color: "secondary"
		}, state[\`\${side}_currency_symbol\`])), /* @__PURE__ */ __dil.jsx("box", {
			flex: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("input", {
			variant: "plain",
			inputType: "text",
			size: "md",
			fontSize: "fill",
			pill: false,
			value: values.current[\`\${side}Draft\`] ?? formatAmount(values.current[side], state[\`\${side}_currency\`], values.current.direct === side),
			disabled: side === "to" && !(state.exchange_rate > 0),
			onChange: (value) => changeAmount(side, value)
		})))))))));
	}
	function CurrencyConverterWidgetWithSource(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("CurrencyConverterWidgetWithSource", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 210
		});
		return /* @__PURE__ */ __dil.jsx(ResolvedCurrencyConverter, {
			key: \`\${state.from_currency}:\${state.to_currency}:\${state.base_amount}:\${state.exchange_rate}\`,
			state
		});
	}

//#endregion
return CurrencyConverterWidgetWithSource;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=currency-converter-widget-efda9a8788b1.js.map