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
//#region internal/LedgerRecentTransactions.dil.tsx
	function TransactionLogo({ src, alt, icon, size, iconSize = "lg", rounded = true }) {
		const fallback = /* @__PURE__ */ __dil.jsx("box", {
			size,
			radius: "full",
			background: "alpha-10",
			align: "center",
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: icon || "compass",
			size: iconSize,
			color: "primary"
		}));
		return src ? /* @__PURE__ */ __dil.jsx("box", {
			size,
			radius: "full",
			align: "center",
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("image", {
			src,
			alt,
			width: size,
			height: size,
			radius: rounded ? "full" : void 0,
			fit: "contain",
			fallback
		})) : fallback;
	}

//#endregion
//#region LedgerSpendByCategoryRecentTransactions.dil.tsx
	function LedgerSpendByCategoryRecentTransactions(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("LedgerSpendByCategoryRecentTransactions", props);
		if (!state && resolutionComplete) return props.fallback ?? null;
		if (state?.has_connected_accounts === false) return /* @__PURE__ */ __dil.jsx(LedgerNoAccounts, { labels: state.labels });
		const loading = !state || state.is_loading;
		return /* @__PURE__ */ __dil.jsx("col", {
			width: "100%",
			maxWidth: "100%",
			gap: 0
		}, loading ? /* @__PURE__ */ __dil.jsx("col", { gap: 0 }, /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, [0, 1].map((index) => /* @__PURE__ */ __dil.jsx("col", {
			key: index,
			gap: 0
		}, /* @__PURE__ */ __dil.jsx("row", {
			gap: 3,
			align: "center",
			width: "100%",
			padding: { y: 2 }
		}, /* @__PURE__ */ __dil.jsx("box", {
			size: 32,
			background: "alpha-10",
			radius: "full"
		}), /* @__PURE__ */ __dil.jsx("col", {
			flex: 1,
			minWidth: 0,
			gap: .5
		}, /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "64%",
			height: 20
		}), /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "42%",
			height: 20
		})), /* @__PURE__ */ __dil.jsx("loading-block", {
			width: 56,
			height: 20
		})), index !== 1 && /* @__PURE__ */ __dil.jsx("divider", null))))) : state.recent_transactions.length > 0 ? /* @__PURE__ */ __dil.jsx("col", { gap: 0 }, /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, state.recent_transactions.map((transaction, index) => /* @__PURE__ */ __dil.jsx("col", {
			key: transaction.id,
			gap: 0
		}, /* @__PURE__ */ __dil.jsx("row", {
			gap: 3,
			align: "center",
			width: "100%",
			padding: { y: 2 }
		}, /* @__PURE__ */ __dil.jsx(TransactionLogo, {
			src: transaction.logo_url,
			icon: transaction.icon || "compass",
			size: 32,
			iconSize: "md"
		}), /* @__PURE__ */ __dil.jsx("col", {
			flex: 1,
			minWidth: 0,
			gap: .5
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			maxLines: 1
		}, transaction.display_name), /* @__PURE__ */ __dil.jsx("caption", {
			size: "sm",
			color: "secondary",
			truncate: true
		}, transaction.date_label)), /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			width: "max-content"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			textAlign: "end",
			maxLines: 1
		}, state.sensitive_values_hidden ? state.labels.masked_value : transaction.amount_label))), index < state.recent_transactions.length - 1 && /* @__PURE__ */ __dil.jsx("divider", null))))) : /* @__PURE__ */ __dil.jsx("row", {
			gap: 3,
			align: "center"
		}, /* @__PURE__ */ __dil.jsx("box", {
			size: 36,
			radius: "full",
			background: "alpha-10",
			align: "center",
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: "receipt",
			size: "lg",
			color: "secondary"
		})), /* @__PURE__ */ __dil.jsx("col", { gap: 0 }, /* @__PURE__ */ __dil.jsx("caption", { size: "md" }, state.labels.no_recent_transactions_for_month))));
	}

//#endregion
return LedgerSpendByCategoryRecentTransactions;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=ledger-spend-by-category-recent-transactions-7b84da874d9a.js.map