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
//#region TennisPlayerSummaryWidgetWithSource.dil.tsx
	function TennisPlayerSummaryWidgetWithSource(props) {
		const liveActivity = useIsLiveActivity();
		const isWide = DIL.useBreakpoint("sm");
		const { state, resolutionComplete } = useResolvedComponentResult("TennisPlayerSummaryWidgetWithSource", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 320
		});
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
		}, /* @__PURE__ */ __dil.jsx("title", {
			size: "sm",
			truncate: true
		}, state.player.display_name), /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary",
			truncate: true
		}, \`\${state.player.country_flag ? \`\${state.player.country_flag} \` : ""}#\${state.player.rank}\`)), (state.is_live || state.last_match_score !== "" || state.last_match_date_label !== "") && /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			weight: "medium",
			truncate: true
		}, \`\${state.last_match_opponent_label}\${state.last_match_score !== "" ? \` • \${state.last_match_score}\` : ""}\`)));
		const hasImage = Boolean(state.image && state.image_content_url);
		const image = hasImage ? /* @__PURE__ */ __dil.jsx("grid-item", null, /* @__PURE__ */ __dil.jsx("box", {
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
			fit: state.image_fit,
			radius: "none",
			width: "100%",
			height: isWide ? 0 : void 0,
			minHeight: isWide ? "100%" : void 0,
			aspectRatio: isWide ? void 0 : "3/2",
			maxHeight: isWide ? void 0 : 400,
			hideOnFailure: !isWide
		})))) : null;
		return /* @__PURE__ */ __dil.jsx("card", {
			padding: 0,
			size: "full",
			variant: "soft",
			background: "transparent",
			radius: 0
		}, /* @__PURE__ */ __dil.jsx("grid", {
			columns: isWide ? 2 : 1,
			gap: 0
		}, !isWide && image, /* @__PURE__ */ __dil.jsx("grid-item", { span: !hasImage && isWide ? 2 : 1 }, /* @__PURE__ */ __dil.jsx("box", { flex: 1 }, /* @__PURE__ */ __dil.jsx("col", {
			padding: {
				left: 0,
				right: isWide && hasImage ? 5 : 0,
				top: !isWide && hasImage ? 5 : 0,
				bottom: 0
			},
			gap: 3
		}, /* @__PURE__ */ __dil.jsx("col", { gap: 1 }, /* @__PURE__ */ __dil.jsx("title", { size: "lg" }, state.player.display_name), /* @__PURE__ */ __dil.jsx("row", { align: "center" }, /* @__PURE__ */ __dil.jsx("text", { size: "md" }, state.player.country_flag), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, \`#\${state.player.rank}\`), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, "•"), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, \`b. \${state.player_profile.date_of_birth}\`))), /* @__PURE__ */ __dil.jsx("divider", null), /* @__PURE__ */ __dil.jsx("col", { gap: 3 }, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium"
		}, state.season_stats_header), /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 3
		}, state.season_stats.map((stat) => /* @__PURE__ */ __dil.jsx("col", {
			key: stat.header,
			flex: 1
		}, /* @__PURE__ */ __dil.jsx("text", {
			color: "secondary",
			size: "xs"
		}, stat.header), /* @__PURE__ */ __dil.jsx("text", {
			weight: "medium",
			size: "lg"
		}, stat.value))))), /* @__PURE__ */ __dil.jsx("divider", null), /* @__PURE__ */ __dil.jsx("col", { gap: 1 }, /* @__PURE__ */ __dil.jsx("row", {
			gap: 1,
			align: "center"
		}, state.is_live ? /* @__PURE__ */ __dil.jsx("box", {
			background: "red-500",
			padding: { x: 1 },
			radius: "md"
		}, /* @__PURE__ */ __dil.jsx("text", {
			color: "white",
			size: "xs",
			weight: "semibold"
		}, state.live_label)) : /* @__PURE__ */ __dil.jsx("text", {
			weight: "medium",
			size: "sm"
		}, state.last_match_label), /* @__PURE__ */ __dil.jsx("text", {
			weight: "medium",
			size: "sm"
		}, state.last_match_opponent_label)), /* @__PURE__ */ __dil.jsx("row", { align: "center" }, /* @__PURE__ */ __dil.jsx("text", {
			color: "secondary",
			weight: "medium",
			size: "xs"
		}, \`\${state.is_live ? "" : state.last_match_result} \${state.last_match_score}\${state.is_live ? "" : \` • \${state.last_match_date_label}\`}\`)))))), isWide && image));
	}

//#endregion
return TennisPlayerSummaryWidgetWithSource;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=tennis-player-summary-widget-with-source-4d46550d9888.js.map