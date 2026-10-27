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
//#region LedgerRepairBankConnectionWidget.dil.tsx
	function LedgerRepairBankConnectionWidget(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("LedgerRepairBankConnectionWidget", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 100
		});
		const openRepair = () => GenUI.dispatchAction({
			handler: "client",
			type: "open_entity_detail",
			payload: {
				category: "ledger_add_account_prompt",
				query: state.prompt,
				extraParams: {
					card_id: state.id,
					title: state.title,
					system_hint: state.system_hint,
					ledger_link_id: state.ledger_link_id
				}
			}
		});
		if (state.cta_label && state.ledger_link_id) return /* @__PURE__ */ __dil.jsx("card", {
			size: "full",
			background: "surface-secondary"
		}, /* @__PURE__ */ __dil.jsx("row", {
			gap: 3,
			align: "center",
			width: "100%",
			wrap: "wrap"
		}, /* @__PURE__ */ __dil.jsx("col", {
			flex: 1,
			gap: 1
		}, /* @__PURE__ */ __dil.jsx("title", { size: "sm" }, state.title), /* @__PURE__ */ __dil.jsx("text", { size: "sm" }, state.description)), /* @__PURE__ */ __dil.jsx("button", {
			loading: state.ledger_repair_initializing === true,
			color: "info",
			size: "lg",
			onClick: openRepair
		}, state.cta_label)));
		return /* @__PURE__ */ __dil.jsx("card", {
			size: "full",
			background: "surface-elevated"
		}, /* @__PURE__ */ __dil.jsx("row", {
			gap: 3,
			align: "stretch"
		}, /* @__PURE__ */ __dil.jsx("box", {
			size: 40,
			background: "orange-500",
			radius: "xl",
			align: "center",
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: "warning",
			color: "white",
			size: "xl"
		})), /* @__PURE__ */ __dil.jsx("col", {
			flex: 1,
			gap: 1
		}, /* @__PURE__ */ __dil.jsx("row", { align: "center" }, /* @__PURE__ */ __dil.jsx("title", { size: "sm" }, state.title)), /* @__PURE__ */ __dil.jsx("text", { size: "sm" }, state.description))));
	}

//#endregion
return LedgerRepairBankConnectionWidget;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=ledger-repair-bank-connection-widget-372daa422873.js.map