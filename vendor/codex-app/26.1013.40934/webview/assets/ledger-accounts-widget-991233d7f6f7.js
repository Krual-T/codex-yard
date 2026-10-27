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
//#region LedgerAccountsWidget.dil.tsx
	function ResolvedAccounts({ state }) {
		const desktop = DIL.useBreakpoint("sm");
		const { isDark } = DIL.useTheme();
		const [activeView, setActiveView] = DIL.useState(state.active_view);
		const view = state.views[activeView];
		const hidden = state.sensitive_values_hidden;
		const chart = /* @__PURE__ */ __dil.jsx("pie-chart", {
			size: 244,
			data: state.chart_categories[activeView].map((category) => ({
				id: category.id,
				label: category.label,
				amount_value: category.amount_value,
				formatted: hidden ? category.percent_label : category.amount_label + " (" + category.percent_label + ")",
				fill: category.color,
				stroke: isDark ? "#303030" : "#ffffff"
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
		return /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			maxWidth: "100%",
			background: "surface-elevated",
			padding: 0,
			radius: "4xl",
			border: 1,
			clip: true
		}, /* @__PURE__ */ __dil.jsx("col", { gap: 0 }, /* @__PURE__ */ __dil.jsx("col", {
			gap: 2,
			padding: {
				x: 6,
				top: 5,
				bottom: 3
			}
		}, /* @__PURE__ */ __dil.jsx("row", { align: "start" }, /* @__PURE__ */ __dil.jsx("col", { flex: "auto" }, /* @__PURE__ */ __dil.jsx("title", { size: "md" }, state.title)), /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			width: "max-content"
		}, /* @__PURE__ */ __dil.jsx("title", {
			size: "md",
			textAlign: "end",
			maxLines: 1
		}, hidden ? state.labels.masked_value : view.total_value_label))), /* @__PURE__ */ __dil.jsx("segmented-control", {
			variant: "soft",
			size: "md",
			options: state.view_options,
			value: activeView,
			label: state.view_selector_label,
			onChange: setActiveView,
			block: !desktop,
			pill: true
		}), view.currency_conversion.currency_conversion_note && /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			weight: "normal",
			color: "secondary"
		}, view.currency_conversion.currency_conversion_note)), view.has_holdings ? desktop ? /* @__PURE__ */ __dil.jsx("row", {
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
		}, chart), /* @__PURE__ */ __dil.jsx("box", {
			flex: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("transition", null, /* @__PURE__ */ __dil.jsx("col", {
			key: activeView,
			minWidth: 0,
			gap: 0,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, view.categories.map((item, index) => /* @__PURE__ */ __dil.jsx("row", {
			key: item.id,
			align: "center",
			gap: 4,
			width: "100%",
			height: 48,
			border: index === 0 ? void 0 : { top: {
				size: 1,
				color: "subtle"
			} }
		}, /* @__PURE__ */ __dil.jsx("col", {
			flex: 1,
			minWidth: 0,
			gap: 1,
			height: 40,
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			maxLines: 1
		}, item.label), /* @__PURE__ */ __dil.jsx("col", {
			gap: 0,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("box", {
			height: 4,
			radius: "full",
			background: "alpha-10",
			width: "100%",
			clip: true
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: item.bar_width,
			height: 4,
			radius: "full",
			background: item.color
		})), /* @__PURE__ */ __dil.jsx("box", { height: 3 }))), /* @__PURE__ */ __dil.jsx("box", { align: "end" }, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			textAlign: "end"
		}, hidden ? item.percent_label : item.amount_label))))))))) : /* @__PURE__ */ __dil.jsx("col", {
			gap: 0,
			padding: {
				x: 6,
				top: 3,
				bottom: 6
			}
		}, /* @__PURE__ */ __dil.jsx("box", {
			align: "center",
			justify: "center"
		}, chart), /* @__PURE__ */ __dil.jsx("box", {
			gap: 0,
			padding: {
				top: 3,
				bottom: 3
			}
		}, /* @__PURE__ */ __dil.jsx("divider", { spacing: 0 })), /* @__PURE__ */ __dil.jsx("transition", null, /* @__PURE__ */ __dil.jsx("col", {
			key: activeView,
			gap: 2
		}, hidden ? view.categories.map((item) => /* @__PURE__ */ __dil.jsx("row", {
			key: item.id,
			align: "center",
			justify: "between",
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("row", {
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
		}, item.label)), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			maxLines: 1
		}, item.percent_label))) : /* @__PURE__ */ __dil.jsx("grid", {
			columns: [
				"minmax(0, 1fr)",
				"max-content",
				"max-content"
			],
			gap: "0.5rem 1rem"
		}, /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, view.categories.map((item) => /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("grid-item", { key: item.id + "-label" }, /* @__PURE__ */ __dil.jsx("row", {
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
		}, item.label))), /* @__PURE__ */ __dil.jsx("grid-item", { key: item.id + "-percent" }, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			textAlign: "end",
			maxLines: 1
		}, item.percent_label)), /* @__PURE__ */ __dil.jsx("grid-item", { key: item.id + "-amount" }, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			textAlign: "end",
			maxLines: 1
		}, item.amount_label))))))))) : /* @__PURE__ */ __dil.jsx("box", { padding: {
			x: 6,
			y: 4
		} }, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, view.empty_state_label))));
	}
	function LedgerAccountsWidget(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("LedgerAccountsWidget", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 400
		});
		if (state.has_connected_accounts === false) return /* @__PURE__ */ __dil.jsx(LedgerNoAccounts, { labels: state.labels });
		return /* @__PURE__ */ __dil.jsx(ResolvedAccounts, { state });
	}

//#endregion
return LedgerAccountsWidget;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=ledger-accounts-widget-991233d7f6f7.js.map