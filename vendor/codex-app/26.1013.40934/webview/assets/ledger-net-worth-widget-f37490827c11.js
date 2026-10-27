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
	function LedgerEmpty({ label, icon = "calendar" }) {
		return /* @__PURE__ */ __dil.jsx("row", {
			gap: 3,
			align: "center",
			padding: { y: 6 }
		}, /* @__PURE__ */ __dil.jsx("box", {
			size: 36,
			radius: "full",
			background: "alpha-10",
			align: "center",
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: icon,
			size: "lg",
			color: "secondary"
		})), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, label));
	}

//#endregion
//#region LedgerNetWorthWidget.dil.tsx
	function LedgerNetWorthWidget(props) {
		const result = useResolvedComponentResult("LedgerNetWorthWidget", props);
		if (!result.state) return result.resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 450
		});
		if (result.state.has_connected_accounts === false && !result.state.has_net_worth_data) return /* @__PURE__ */ __dil.jsx(LedgerNoAccounts, { labels: result.state.labels });
		return /* @__PURE__ */ __dil.jsx(Resolved, { state: result.state });
	}
	function Resolved({ state }) {
		const [selected, setSelected] = DIL.useState(state.selected_interval ?? state.default_interval);
		const [hover, setHover] = DIL.useState(null);
		const current = state.interval_views[selected];
		const hidden = state.sensitive_values_hidden ?? false;
		return /* @__PURE__ */ __dil.jsx("card", {
			size: "full",
			background: "surface-elevated",
			padding: 0
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: 0,
			padding: { bottom: 4 }
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: 1,
			padding: {
				x: 6,
				top: 5,
				bottom: 3
			},
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "start",
			gap: 3,
			minWidth: 0,
			width: "100%",
			wrap: "nowrap"
		}, /* @__PURE__ */ __dil.jsx("box", {
			flex: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("title", {
			size: "md",
			maxLines: 1,
			truncate: true
		}, state.label === "Net Worth" ? "Net worth" : state.label)), state.has_net_worth_data && current ? /* @__PURE__ */ __dil.jsx("title", {
			size: "md",
			textAlign: "end",
			maxLines: 1,
			truncate: true
		}, hidden ? state.labels.masked_value : hover?.formatted_net_worth ?? current.current_value_label) : null), state.has_net_worth_data && current ? /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("col", {
			gap: .5,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 1,
			minWidth: 0,
			width: "100%",
			wrap: "nowrap"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			color: current.change > 0 ? "#30A633" : "danger",
			maxLines: 1,
			truncate: true
		}, !hidden && current.change !== 0 ? \`\${current.change > 0 ? "+" : ""}\${current.change_label} (\${current.change > 0 ? "↗" : "↘"} \${current.change_percent_label})\` : ""), !hidden && current.change !== 0 ? /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			color: "secondary"
		}, state.labels.separator_dot) : null, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			color: "secondary",
			maxLines: 1,
			truncate: true
		}, current.change_window_label))), state.currency_conversion?.currency_conversion_note ? /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary",
			truncate: true,
			maxLines: 1
		}, state.currency_conversion.currency_conversion_note) : null) : null, state.balance_status_note ? /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary"
		}, state.balance_status_note) : null), /* @__PURE__ */ __dil.jsx("box", {
			gap: 0,
			padding: { x: 6 }
		}, /* @__PURE__ */ __dil.jsx("divider", { spacing: 0 })), !state.has_net_worth_data ? /* @__PURE__ */ __dil.jsx("box", { padding: { x: 6 } }, /* @__PURE__ */ __dil.jsx(LedgerEmpty, {
			label: state.empty_state_label,
			icon: "banknote"
		})) : current ? /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, state.interval_order.length ? /* @__PURE__ */ __dil.jsx("col", {
			gap: 0,
			padding: {
				x: 6,
				top: 3,
				bottom: 1
			}
		}, /* @__PURE__ */ __dil.jsx("segmented-control", {
			options: state.interval_order.map((key) => ({
				value: key,
				label: state.interval_views[key].label
			})),
			value: selected,
			onChange: (value) => {
				setSelected(value);
				setHover(null);
				GenUI.dispatchAction({
					type: "log_event",
					handler: "client",
					payload: {
						event_name: "chatgpt_widget_action",
						event_data: {
							widget_affordance: "OPTION",
							widget_action_target: "net_worth_interval",
							widget_action_value: value,
							surface_location: "RESPONSE",
							content_reference_type: "ledger_net_worth"
						}
					}
				});
			},
			variant: "ghost",
			size: "md",
			pill: true
		})) : null, /* @__PURE__ */ __dil.jsx("box", { padding: {
			left: 6,
			right: 2,
			top: 3
		} }, /* @__PURE__ */ __dil.jsx("chart", {
			height: 306,
			data: current.chart_points,
			series: current.series,
			xAxis: {
				dataKey: "date",
				hide: true,
				axisLine: false,
				labels: current.x_axis_labels,
				ticks: current.x_axis_ticks,
				tickMargin: 8,
				interval: 0,
				padding: "no-gap"
			},
			yAxis: hidden ? {
				domain: current.y_axis_domain,
				ticks: current.y_axis_ticks ?? void 0
			} : {
				domain: current.y_axis_domain,
				ticks: current.y_axis_ticks ?? void 0,
				orientation: "right",
				axisLine: false,
				tickFormatter: {
					type: "currency",
					currency: state.currency_code,
					notation: "compact",
					decimals: 3
				}
			},
			tooltipValueFormatter: (input) => {
				const point = input.payload;
				return hidden ? point.tooltip_label_sensitive_values_hidden : point.tooltip_label;
			},
			showYAxis: !hidden,
			showLegend: false,
			showTooltip: true,
			tooltipOffset: 24,
			tooltipPlacement: "abovePoint",
			showGrid: true,
			disableAnimation: true,
			onHover: (snapshot) => setHover(hidden ? null : snapshot.payload)
		}))) : null));
	}

//#endregion
return LedgerNetWorthWidget;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=ledger-net-worth-widget-f37490827c11.js.map