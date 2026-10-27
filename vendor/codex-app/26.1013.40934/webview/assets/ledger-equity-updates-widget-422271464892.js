import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";var t;function n(){return(n=e((()=>{t=`(() => {
var __dilDefaultExport = (function() {


//#region internal/LedgerNoAccounts.dil.tsx
	function LedgerNoAccounts({ labels }) {
		return /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			background: "surface-elevated",
			padding: 0,
			radius: "4xl",
			border: true
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			justify: "between",
			gap: 4,
			padding: {
				x: 6,
				y: 6
			},
			width: "100%",
			wrap: "nowrap"
		}, /* @__PURE__ */ __dil.jsx("col", {
			flex: 1,
			minWidth: 0,
			gap: 1
		}, /* @__PURE__ */ __dil.jsx("title", { size: "md" }, labels.no_accounts_title), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, labels.no_accounts_description)), /* @__PURE__ */ __dil.jsx("button", { onClick: () => {
			const action = JSON.parse(labels.no_accounts_action);
			if (action?.handler === "client" && action.type === "issue_new_turn" && action.fallbackAction === void 0 && (action.payload?.action ?? action.type) === "issue_new_turn" && typeof action.payload?.query === "string" && action.payload.message_metadata?.starter_prompt_id === "ledger-widget-no-accounts" && action.payload.message_metadata?.suggestion_type === "starter") {
				GenUI.issueNewTurn(action.payload.query, { followup_metadata: {
					starter_prompt_id: "ledger-widget-no-accounts",
					suggestion_type: "starter",
					system_hints: ["connector:ledger_onboarding_force", "connector:connector_693864f100e4819093e6ed9b651239f1"]
				} });
				return;
			}
			GenUI.dispatchAction(action);
		} }, labels.no_accounts_cta_label)));
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
//#region LedgerEquityUpdatesWidget.dil.tsx
	function ResolvedEquity({ state }) {
		const desktop = DIL.useBreakpoint("sm");
		const [rowsToShow, setRowsToShow] = DIL.useState(5);
		const rows = state.rows.slice(0, rowsToShow);
		const headers = [
			state.labels.stock,
			state.labels.price,
			state.labels.day_change_percent,
			state.labels.day_change_value
		];
		const widths = [
			82,
			82,
			96,
			desktop ? 110 : 96
		];
		return /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			maxWidth: "100%",
			background: "surface-elevated",
			padding: 0,
			radius: "4xl",
			border: 1,
			clip: true
		}, /* @__PURE__ */ __dil.jsx("col", { gap: 0 }, /* @__PURE__ */ __dil.jsx("row", {
			align: "start",
			gap: 4,
			padding: {
				x: 6,
				top: 5,
				bottom: 3
			}
		}, /* @__PURE__ */ __dil.jsx("col", {
			flex: 1,
			gap: .5
		}, /* @__PURE__ */ __dil.jsx("title", { size: "md" }, state.title), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "normal",
			color: "secondary"
		}, state.as_of_label), state.currency_conversion.currency_conversion_note && /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary"
		}, state.currency_conversion.currency_conversion_note))), /* @__PURE__ */ __dil.jsx("box", {
			gap: 0,
			padding: { x: 6 }
		}, /* @__PURE__ */ __dil.jsx("divider", { spacing: 0 })), state.has_positions ? /* @__PURE__ */ __dil.jsx("box", { padding: {
			x: 6,
			top: desktop ? 1 : 0,
			bottom: 6
		} }, /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			minWidth: 0,
			direction: desktop ? void 0 : "row",
			scrollable: !desktop
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: desktop ? "100%" : "max-content",
			padding: { right: desktop ? 0 : 12 }
		}, /* @__PURE__ */ __dil.jsx("col", { gap: 0 }, /* @__PURE__ */ __dil.jsx("box", {
			height: desktop ? 16 : 32,
			justify: "center",
			padding: { bottom: desktop ? 0 : 1 }
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			justify: desktop ? "between" : "start",
			gap: desktop ? 0 : 4,
			wrap: "nowrap",
			width: desktop ? "100%" : void 0
		}, /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, headers.map((label, index) => /* @__PURE__ */ __dil.jsx("box", {
			key: index,
			flex: desktop && index < 3 ? 1 : void 0,
			width: desktop && index < 3 ? void 0 : widths[index],
			minWidth: widths[index],
			padding: { left: desktop && index === 3 ? 3.5 : 0 }
		}, /* @__PURE__ */ __dil.jsx("caption", {
			size: "md",
			weight: "normal",
			color: "secondary",
			truncate: true
		}, label)))))), /* @__PURE__ */ __dil.jsx("divider", null), /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, rows.map((item, index) => /* @__PURE__ */ __dil.jsx("col", {
			key: item.id,
			gap: 0
		}, /* @__PURE__ */ __dil.jsx("box", { padding: index === rows.length - 1 ? { top: 2 } : { y: 2 } }, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			justify: desktop ? "between" : "start",
			gap: desktop ? 0 : 4,
			wrap: "nowrap",
			width: desktop ? "100%" : void 0
		}, /* @__PURE__ */ __dil.jsx("col", {
			flex: desktop ? 1 : void 0,
			width: desktop ? void 0 : 82,
			minWidth: 82,
			height: desktop ? void 0 : 46,
			justify: "center",
			gap: 0
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: desktop ? "sm" : "md",
			weight: "normal",
			truncate: true
		}, item.ticker), /* @__PURE__ */ __dil.jsx("caption", {
			size: "md",
			weight: "normal",
			color: "secondary",
			truncate: true,
			maxLines: 1
		}, item.name)), /* @__PURE__ */ __dil.jsx("box", {
			flex: desktop ? 1 : void 0,
			width: desktop ? void 0 : 82,
			minWidth: 82,
			height: desktop ? void 0 : 46,
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: desktop ? "sm" : "md",
			weight: "normal",
			truncate: true
		}, item.price_label)), /* @__PURE__ */ __dil.jsx("box", {
			flex: desktop ? 1 : void 0,
			width: desktop ? void 0 : 96,
			minWidth: 96,
			height: desktop ? void 0 : 46,
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: desktop ? "sm" : "md",
			weight: "normal",
			truncate: true,
			color: item.day_change_percent_color
		}, (item.day_change_percent_direction === "down" ? state.labels.down_indicator : item.day_change_percent_direction === "up" ? state.labels.up_indicator : "") + item.day_change_percent_label)), /* @__PURE__ */ __dil.jsx("box", {
			width: desktop ? 110 : 96,
			minWidth: desktop ? 110 : 96,
			height: desktop ? void 0 : 46,
			align: desktop ? "end" : void 0,
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("text", {
			width: 96,
			size: desktop ? "sm" : "md",
			weight: "normal",
			truncate: true,
			color: state.sensitive_values_hidden ? "primary" : item.day_change_value_color
		}, state.sensitive_values_hidden ? state.labels.masked_value : (item.day_change_value_direction === "down" ? state.labels.down_indicator : item.day_change_value_direction === "up" ? state.labels.up_indicator : "") + item.day_change_value_label)))), index < rows.length - 1 && /* @__PURE__ */ __dil.jsx("divider", null))))))), state.rows.length > 5 && /* @__PURE__ */ __dil.jsx("box", { padding: { top: 5 } }, /* @__PURE__ */ __dil.jsx("button", {
			variant: "soft",
			block: true,
			onClick: () => setRowsToShow(rowsToShow === 5 ? 999 : 5)
		}, rowsToShow === 5 ? state.labels.show_more : state.labels.show_less))) : /* @__PURE__ */ __dil.jsx("box", { padding: {
			x: 6,
			y: 4
		} }, /* @__PURE__ */ __dil.jsx("caption", { size: "md" }, state.empty_state_label))));
	}
	function LedgerEquityUpdatesWidget(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("LedgerEquityUpdatesWidget", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 340
		});
		if (state.has_connected_accounts === false) return /* @__PURE__ */ __dil.jsx(LedgerNoAccounts, { labels: state.labels });
		return /* @__PURE__ */ __dil.jsx(ResolvedEquity, { state });
	}

//#endregion
return LedgerEquityUpdatesWidget;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=ledger-equity-updates-widget-422271464892.js.map