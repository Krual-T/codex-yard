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
	function LedgerAvatar({ item, size = 32 }) {
		const fallback = /* @__PURE__ */ __dil.jsx("box", {
			size,
			radius: "full",
			background: "alpha-10",
			align: "center",
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: item.icon ?? "compass",
			size: size > 32 ? "xl" : "lg"
		}));
		return item.logo_url ? /* @__PURE__ */ __dil.jsx("box", {
			size,
			align: "center",
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("image", {
			src: item.logo_url,
			width: size,
			height: size,
			fit: "contain",
			fallback
		})) : fallback;
	}
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
//#region LedgerFeeInterestPaidWidget.dil.tsx
	function LedgerFeeInterestPaidWidget(props) {
		const result = useResolvedComponentResult("LedgerFeeInterestPaidWidget", props);
		if (!result.state) return result.resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 250
		});
		if (result.state.has_connected_accounts === false) return /* @__PURE__ */ __dil.jsx(LedgerNoAccounts, { labels: result.state.labels });
		return /* @__PURE__ */ __dil.jsx(Resolved, { state: result.state });
	}
	function Resolved({ state }) {
		const wide = DIL.useBreakpoint("sm");
		const [selected, setSelected] = DIL.useState(state.selected_time_range_index);
		const [rows, setRows] = DIL.useState(state.rows_to_show ?? 5);
		const view = state.time_range_views[selected];
		return /* @__PURE__ */ __dil.jsx("card", {
			size: "full",
			background: "surface-elevated",
			padding: 0
		}, /* @__PURE__ */ __dil.jsx("col", { gap: 0 }, /* @__PURE__ */ __dil.jsx("row", {
			align: "start",
			padding: {
				x: 6,
				top: 5,
				bottom: 0
			}
		}, /* @__PURE__ */ __dil.jsx("col", {
			flex: 1,
			minWidth: 0,
			gap: 0
		}, /* @__PURE__ */ __dil.jsx("title", { size: "md" }, state.title), /* @__PURE__ */ __dil.jsx("row", { align: "center" }, /* @__PURE__ */ __dil.jsx("select", {
			name: "selected_time_range",
			options: state.time_range_views.map((item) => ({
				label: item.option_label,
				value: item.option_value
			})),
			value: view.option_value,
			onChange: (value) => {
				setSelected(state.time_range_views.findIndex((item) => item.option_value === value));
				setRows(5);
			},
			variant: "ghost",
			size: "sm"
		}))), /* @__PURE__ */ __dil.jsx("title", {
			size: "md",
			textAlign: "end",
			maxLines: 1
		}, state.sensitive_values_hidden ? state.labels.masked_value : view.total_paid_label)), view.total_paid === null ? /* @__PURE__ */ __dil.jsx("box", { padding: {
			x: 6,
			bottom: 2
		} }, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, view.total_status_label)) : view.currency_conversion?.currency_conversion_note ? /* @__PURE__ */ __dil.jsx("box", { padding: {
			x: 6,
			bottom: 2
		} }, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, view.currency_conversion.currency_conversion_note)) : null, /* @__PURE__ */ __dil.jsx("box", {
			gap: 0,
			padding: {
				x: 6,
				y: 1
			}
		}, /* @__PURE__ */ __dil.jsx("divider", { spacing: 0 })), /* @__PURE__ */ __dil.jsx("col", {
			gap: 0,
			padding: {
				x: 6,
				bottom: view.transactions.length ? 5 : 0
			}
		}, /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, view.transactions.length === 0 && view.total_paid !== null ? /* @__PURE__ */ __dil.jsx(LedgerEmpty, {
			label: view.empty_state_label,
			icon: "check-circle"
		}) : view.transactions.slice(0, rows).map((item, index) => /* @__PURE__ */ __dil.jsx("col", {
			key: item.id,
			gap: 0
		}, /* @__PURE__ */ __dil.jsx("row", {
			gap: 4,
			align: "center",
			width: "100%",
			padding: { y: wide ? 2 : 2.5 }
		}, /* @__PURE__ */ __dil.jsx(LedgerAvatar, {
			item: {
				logo_url: item.logo_url,
				icon: item.category_icon ?? "bank"
			},
			size: wide ? 32 : 40
		}), /* @__PURE__ */ __dil.jsx("col", {
			flex: 1,
			minWidth: 0,
			gap: 0
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: wide ? "sm" : "md",
			maxLines: 1
		}, item.display_name), /* @__PURE__ */ __dil.jsx("row", {
			gap: 1,
			align: "center",
			minWidth: 0,
			wrap: "nowrap"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary",
			maxLines: 1
		}, item.date_label), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, "-"), /* @__PURE__ */ __dil.jsx("box", {
			flex: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary",
			truncate: true,
			maxLines: 1
		}, \`\${item.category_label} - \${item.account_detail}\`)))), /* @__PURE__ */ __dil.jsx("text", {
			textAlign: "end",
			size: wide ? "sm" : "md",
			color: state.sensitive_values_hidden ? "primary" : item.amount_color,
			maxLines: 1
		}, state.sensitive_values_hidden ? item.masked_amount_label : item.amount_label)), index < Math.min(rows, view.transactions.length) - 1 ? /* @__PURE__ */ __dil.jsx("divider", null) : null))), view.transactions.length > 5 ? /* @__PURE__ */ __dil.jsx("box", { padding: { top: 5 } }, /* @__PURE__ */ __dil.jsx("button", {
			variant: "soft",
			block: true,
			onClick: () => setRows(rows === 5 ? view.transactions.length : 5)
		}, rows === 5 ? state.labels.see_more : state.labels.show_less)) : null)));
	}

//#endregion
return LedgerFeeInterestPaidWidget;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=ledger-fee-interest-paid-widget-cc3447ee6d07.js.map