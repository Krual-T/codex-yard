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
//#region WordCardWidget.dil.tsx
	function WordCardWidget(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("WordCardWidget", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 280
		});
		return /* @__PURE__ */ __dil.jsx("card", { size: "full" }, /* @__PURE__ */ __dil.jsx("col", { gap: 3 }, /* @__PURE__ */ __dil.jsx("row", { align: "center" }, /* @__PURE__ */ __dil.jsx("title", { size: "lg" }, state.spelling.headword), /* @__PURE__ */ __dil.jsx("spacer", null), /* @__PURE__ */ __dil.jsx("badge", null, state.partOfSpeech)), state.ipa && /* @__PURE__ */ __dil.jsx("row", { align: "center" }, /* @__PURE__ */ __dil.jsx("text", { color: "secondary" }, state.ipa)), state.spelling.alt.length > 0 && /* @__PURE__ */ __dil.jsx("row", { align: "center" }, /* @__PURE__ */ __dil.jsx("caption", null, "Also spelled"), /* @__PURE__ */ __dil.jsx("spacer", null), /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 2,
			wrap: "wrap"
		}, state.spelling.alt.map((spelling, index) => /* @__PURE__ */ __dil.jsx("box", { key: index }, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, spelling))))), state.translationPairs.length > 0 && /* @__PURE__ */ __dil.jsx("col", { gap: 2 }, /* @__PURE__ */ __dil.jsx("divider", null), /* @__PURE__ */ __dil.jsx("caption", null, "Translations"), /* @__PURE__ */ __dil.jsx("col", { gap: 2 }, state.translationPairs.map((pair, index) => /* @__PURE__ */ __dil.jsx("col", {
			key: index,
			gap: 1
		}, /* @__PURE__ */ __dil.jsx("row", { align: "center" }, /* @__PURE__ */ __dil.jsx("caption", null, \`\${state.langFrom} → \${pair.langTo}\`), /* @__PURE__ */ __dil.jsx("spacer", null), /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 2,
			wrap: "wrap"
		}, pair.terms.map((term, termIndex) => /* @__PURE__ */ __dil.jsx("box", { key: termIndex }, /* @__PURE__ */ __dil.jsx("badge", { variant: "soft" }, term))))))))), state.forms.length > 0 && /* @__PURE__ */ __dil.jsx("col", { gap: 2 }, /* @__PURE__ */ __dil.jsx("divider", null), /* @__PURE__ */ __dil.jsx("caption", null, "Key forms"), /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 3,
			wrap: "wrap"
		}, state.forms.map((form, index) => /* @__PURE__ */ __dil.jsx("col", {
			key: index,
			gap: 0
		}, /* @__PURE__ */ __dil.jsx("caption", { color: "tertiary" }, form.label), /* @__PURE__ */ __dil.jsx("text", { size: "sm" }, form.value))))), state.examples.length > 0 && /* @__PURE__ */ __dil.jsx("col", { gap: 2 }, /* @__PURE__ */ __dil.jsx("divider", null), /* @__PURE__ */ __dil.jsx("caption", null, "Examples"), /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, state.examples.map((example, index) => /* @__PURE__ */ __dil.jsx("col", {
			key: index,
			gap: 0
		}, /* @__PURE__ */ __dil.jsx("row", { align: "center" }, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			maxLines: 2
		}, example.sentence), /* @__PURE__ */ __dil.jsx("spacer", null), example.form && /* @__PURE__ */ __dil.jsx("badge", {
			size: "sm",
			variant: "outline"
		}, example.form)))))), state.mnemonic && /* @__PURE__ */ __dil.jsx("col", { gap: 1 }, /* @__PURE__ */ __dil.jsx("divider", null), /* @__PURE__ */ __dil.jsx("caption", null, "Mnemonic"), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, state.mnemonic))));
	}

//#endregion
return WordCardWidget;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=word-card-widget-d1fdadcfb934.js.map