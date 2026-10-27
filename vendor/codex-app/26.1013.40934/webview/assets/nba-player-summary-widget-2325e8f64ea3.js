import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";var t;function n(){return(n=e((()=>{t=`(() => {
var __dilDefaultExport = (function() {


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
//#region NbaPlayerSummaryWidgetWithSource.dil.tsx
	function Stats({ stats }) {
		return /* @__PURE__ */ __dil.jsx("row", { align: "center" }, stats.map((stat) => /* @__PURE__ */ __dil.jsx("col", {
			key: stat.label,
			flex: 1,
			gap: 0
		}, /* @__PURE__ */ __dil.jsx("text", {
			color: "secondary",
			size: "xs"
		}, stat.label), /* @__PURE__ */ __dil.jsx("text", {
			size: "lg",
			weight: "medium"
		}, Math.round(Number(stat.value) * 10) / 10))));
	}
	function LiveLabel({ label }) {
		return /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 1.2
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: 14,
			height: 14,
			background: "red-75",
			radius: "full",
			align: "center",
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: 8,
			height: 8,
			background: "red-400",
			radius: "full"
		})), /* @__PURE__ */ __dil.jsx("text", {
			weight: "semibold",
			color: "red-400",
			size: "sm"
		}, label));
	}
	function NbaPlayerSummaryWidgetWithSource(props) {
		const liveActivity = useIsLiveActivity();
		const isWide = DIL.useBreakpoint("sm");
		const { state, resolutionComplete } = useResolvedComponentResult("NbaPlayerSummaryWidgetWithSource", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 320
		});
		const game = state.recent_game;
		if (liveActivity) return /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			padding: 2,
			theme: "dark",
			background: "surface"
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: .5,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			justify: "between",
			width: "100%",
			gap: 2
		}, /* @__PURE__ */ __dil.jsx("col", {
			flex: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("title", {
			size: "sm",
			truncate: true
		}, state.name ?? "")), /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, state.top_details.slice(0, 2).map((detail, index) => detail.detail_type === "text" ? /* @__PURE__ */ __dil.jsx("text", {
			key: index,
			size: "xs",
			color: "secondary",
			truncate: true
		}, detail.value) : null))), /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			weight: "medium",
			truncate: true
		}, state.focus === "season" ? state.season_stats.statline : game.statline)));
		const image = state.has_image && /* @__PURE__ */ __dil.jsx("grid-item", null, /* @__PURE__ */ __dil.jsx("box", {
			background: {
				light: "gray-100",
				dark: "gray-400"
			},
			padding: 0,
			height: isWide ? "100%" : void 0
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			height: isWide ? "100%" : void 0,
			onClick: () => GenUI.openImageLightbox([state.image], 0)
		}, /* @__PURE__ */ __dil.jsx("image", {
			src: state.image_content_url ?? "",
			fit: "cover",
			radius: "none",
			width: "100%",
			height: isWide ? "100%" : void 0,
			aspectRatio: isWide ? void 0 : "3/2",
			maxHeight: isWide ? void 0 : 300,
			hideOnFailure: true
		}))));
		return /* @__PURE__ */ __dil.jsx("card", {
			padding: 0,
			size: "full",
			variant: "soft",
			background: "transparent",
			radius: 0
		}, /* @__PURE__ */ __dil.jsx("box", {
			align: "stretch",
			padding: 0,
			gap: 0
		}, /* @__PURE__ */ __dil.jsx("grid", {
			columns: isWide ? 2 : 1,
			gap: 0
		}, !isWide && image, /* @__PURE__ */ __dil.jsx("grid-item", { span: state.has_image ? 1 : isWide ? 2 : 1 }, /* @__PURE__ */ __dil.jsx("col", {
			padding: {
				left: 0,
				right: isWide && state.has_image ? 5 : 0,
				top: !isWide && state.has_image ? 5 : 0,
				bottom: 0
			},
			gap: 0
		}, /* @__PURE__ */ __dil.jsx("col", { gap: 1 }, /* @__PURE__ */ __dil.jsx("title", {
			size: "lg",
			weight: "semibold"
		}, state.name ?? ""), /* @__PURE__ */ __dil.jsx("row", { align: "center" }, state.top_details.map((detail, index) => /* @__PURE__ */ __dil.jsx("box", { key: index }, detail.detail_type === "text" ? /* @__PURE__ */ __dil.jsx("text", {
			color: "secondary",
			size: "sm"
		}, detail.value) : /* @__PURE__ */ __dil.jsx("image", {
			src: detail.value,
			fit: "cover",
			width: 20,
			height: 20
		}))))), /* @__PURE__ */ __dil.jsx("divider", { spacing: 3 }), state.focus === "season" ? /* @__PURE__ */ __dil.jsx("col", null, /* @__PURE__ */ __dil.jsx("text", {
			weight: "medium",
			size: "sm"
		}, state.season_stats.label), /* @__PURE__ */ __dil.jsx(Stats, { stats: state.season_stats.stats })) : /* @__PURE__ */ __dil.jsx("col", { gap: 2 }, /* @__PURE__ */ __dil.jsx("col", {
			justify: "start",
			gap: 1
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 1
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 1
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: game.winner === "team" ? "semibold" : "normal"
		}, game.team_name), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: game.winner === "team" ? "semibold" : "normal"
		}, game.team_points)), /* @__PURE__ */ __dil.jsx("text", { size: "sm" }, "•"), /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 1
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: game.winner === "opponent" ? "semibold" : "normal"
		}, game.opponent_name), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: game.winner === "opponent" ? "semibold" : "normal"
		}, game.opponent_points))), game.is_live ? /* @__PURE__ */ __dil.jsx("row", {
			gap: 2,
			align: "start"
		}, /* @__PURE__ */ __dil.jsx(LiveLabel, { label: state.live_label }), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, game.live_time_str ?? "")) : /* @__PURE__ */ __dil.jsx("row", {
			gap: 2,
			align: "start"
		}, /* @__PURE__ */ __dil.jsx("text", {
			weight: "medium",
			size: "sm",
			color: "secondary"
		}, state.final_label ?? ""), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, game.time_str ?? ""))), /* @__PURE__ */ __dil.jsx("spacer", null), /* @__PURE__ */ __dil.jsx(Stats, { stats: game.stats })), /* @__PURE__ */ __dil.jsx("divider", { spacing: 3 }), state.focus === "season" ? /* @__PURE__ */ __dil.jsx("col", { gap: 2 }, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			width: "100%",
			gap: 2,
			wrap: "wrap"
		}, game.is_live ? /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 2
		}, /* @__PURE__ */ __dil.jsx(LiveLabel, { label: state.live_label }), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, game.live_time_str ?? "")) : /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 1
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium"
		}, game.time_str ?? ""), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium"
		}, "•"), /* @__PURE__ */ __dil.jsx("text", {
			weight: "medium",
			size: "sm"
		}, state.final_label ?? "")), /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: .7
		}, /* @__PURE__ */ __dil.jsx("text", {
			color: "secondary",
			size: "sm"
		}, game.team_name ?? ""), /* @__PURE__ */ __dil.jsx("text", {
			color: "secondary",
			size: "sm"
		}, game.team_points ?? ""), /* @__PURE__ */ __dil.jsx("text", {
			color: "secondary",
			size: "sm"
		}, "-"), /* @__PURE__ */ __dil.jsx("text", {
			color: "secondary",
			size: "sm"
		}, game.opponent_name), /* @__PURE__ */ __dil.jsx("text", {
			color: "secondary",
			size: "sm"
		}, game.opponent_points ?? 0))), /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 2,
			wrap: "wrap"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium"
		}, game.stats_label), /* @__PURE__ */ __dil.jsx("text", {
			color: "secondary",
			size: "sm"
		}, game.statline))) : /* @__PURE__ */ __dil.jsx("col", {
			align: "start",
			gap: 1
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium"
		}, state.season_stats.label), /* @__PURE__ */ __dil.jsx("text", {
			color: "secondary",
			size: "sm"
		}, state.season_stats.statline)))), isWide && image)));
	}

//#endregion
return NbaPlayerSummaryWidgetWithSource;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=nba-player-summary-widget-2325e8f64ea3.js.map