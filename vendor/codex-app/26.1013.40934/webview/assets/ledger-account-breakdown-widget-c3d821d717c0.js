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
//#region internal/ledger-overview.dil.tsx
	function LedgerConversionNote({ state }) {
		const note = state.currency_conversion?.currency_conversion_note;
		return note ? /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary"
		}, note) : null;
	}

//#endregion
//#region internal/ledger-distribution.dil.tsx
	function LedgerDistribution({ state }) {
		const wide = DIL.useBreakpoint("sm");
		const dark = DIL.useTheme().isDark;
		const hidden = state.sensitive_values_hidden ?? false;
		const pie = /* @__PURE__ */ __dil.jsx("pie-chart", {
			size: 244,
			data: state.categories.map((category) => ({
				id: category.id,
				label: category.label,
				amount_value: category.amount_value,
				formatted: hidden ? category.percent_label : \`\${category.amount_label} (\${category.percent_label})\`,
				fill: typeof category.color === "object" ? dark ? category.color?.dark : category.color?.light : category.color,
				stroke: dark ? "#303030" : "#ffffff"
			})),
			series: [{
				dataKey: "amount_value",
				label: state.labels.value
			}],
			xAxis: "label",
			showLegend: false,
			innerRadius: "49%",
			outerRadius: "100%",
			paddingAngle: 0,
			cornerRadius: 3,
			tooltipAnimationDuration: 0,
			showTooltip: true
		});
		const rows = /* @__PURE__ */ __dil.jsx("col", {
			flex: 1,
			minWidth: 0,
			gap: 0
		}, state.categories.map((item, index) => /* @__PURE__ */ __dil.jsx("row", {
			key: item.id,
			align: "center",
			gap: 4,
			width: "100%",
			height: 48,
			border: index ? { top: {
				size: 1,
				color: "subtle"
			} } : void 0
		}, /* @__PURE__ */ __dil.jsx("col", {
			flex: 1,
			minWidth: 0,
			gap: 1,
			height: 40,
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			maxLines: 1
		}, item.label), /* @__PURE__ */ __dil.jsx("col", { gap: 0 }, /* @__PURE__ */ __dil.jsx("box", {
			height: 4,
			radius: "full",
			background: "alpha-10",
			width: "100%",
			clip: true
		}, /* @__PURE__ */ __dil.jsx("box", {
			height: 4,
			radius: "full",
			width: item.bar_width,
			background: item.color
		})), /* @__PURE__ */ __dil.jsx("box", { height: 3 }))), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			textAlign: "end"
		}, hidden ? item.percent_label : item.amount_label))));
		const mobileRows = /* @__PURE__ */ __dil.jsx("grid", {
			columns: hidden ? ["minmax(0, 1fr)", "max-content"] : [
				"minmax(0, 1fr)",
				"max-content",
				"max-content"
			],
			gap: "0.5rem 1rem"
		}, state.categories.map((item) => /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("grid-item", { key: \`\${item.id}-label\` }, /* @__PURE__ */ __dil.jsx("row", {
			gap: 2,
			align: "center",
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: 4,
			height: 20,
			radius: "full",
			background: item.color
		}), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary",
			maxLines: 1
		}, item.label))), /* @__PURE__ */ __dil.jsx("grid-item", { key: \`\${item.id}-percent\` }, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			textAlign: "end",
			maxLines: 1
		}, item.percent_label)), !hidden ? /* @__PURE__ */ __dil.jsx("grid-item", { key: \`\${item.id}-amount\` }, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			textAlign: "end",
			maxLines: 1
		}, item.amount_label)) : null)));
		return /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			background: "surface-elevated",
			padding: 0,
			radius: "4xl",
			border: true
		}, /* @__PURE__ */ __dil.jsx("col", { gap: 0 }, /* @__PURE__ */ __dil.jsx("col", {
			gap: 1,
			padding: {
				x: 6,
				top: 5,
				bottom: 3
			}
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "start",
			gap: 4
		}, /* @__PURE__ */ __dil.jsx("col", {
			flex: 1,
			minWidth: 0,
			gap: .5,
			align: "start"
		}, /* @__PURE__ */ __dil.jsx("title", null, state.title), state.has_holdings ? /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, state.subtitle), /* @__PURE__ */ __dil.jsx(LedgerConversionNote, { state })) : null), /* @__PURE__ */ __dil.jsx("title", null, hidden ? state.labels.masked_value : state.total_value_label))), /* @__PURE__ */ __dil.jsx("box", {
			gap: 0,
			padding: { x: 6 }
		}, /* @__PURE__ */ __dil.jsx("divider", { spacing: 0 })), state.has_holdings ? wide ? /* @__PURE__ */ __dil.jsx("row", {
			align: "start",
			gap: 8,
			wrap: "nowrap",
			padding: {
				x: 6,
				top: 3,
				bottom: 6
			},
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: 244,
			minWidth: 244,
			align: "center",
			justify: "center"
		}, pie), rows) : /* @__PURE__ */ __dil.jsx("col", {
			gap: 0,
			padding: {
				x: 6,
				top: 3,
				bottom: 6
			}
		}, /* @__PURE__ */ __dil.jsx("box", {
			align: "center",
			justify: "center"
		}, pie), /* @__PURE__ */ __dil.jsx("box", {
			gap: 0,
			padding: { y: 3 }
		}, /* @__PURE__ */ __dil.jsx("divider", { spacing: 0 })), mobileRows) : /* @__PURE__ */ __dil.jsx("box", { padding: {
			x: 6,
			y: 4
		} }, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, state.empty_state_label))));
	}

//#endregion
//#region LedgerAccountBreakdownWidget.dil.tsx
	function LedgerAccountBreakdownWidget(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("LedgerAccountBreakdownWidget", props);
		if (state?.has_connected_accounts === false) return /* @__PURE__ */ __dil.jsx(LedgerNoAccounts, { labels: state.labels });
		return state ? /* @__PURE__ */ __dil.jsx(LedgerDistribution, { state }) : resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 350
		});
	}

//#endregion
return LedgerAccountBreakdownWidget;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=ledger-account-breakdown-widget-c3d821d717c0.js.map