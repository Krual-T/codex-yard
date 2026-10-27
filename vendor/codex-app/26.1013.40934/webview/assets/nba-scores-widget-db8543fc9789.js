import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";var t;function n(){return(n=e((()=>{t=`(() => {
var __dilDefaultExport = (function() {


//#region internal/NbaBoxscore.dil.tsx
	function NbaBoxscore({ state, detail, backLabel, onBack }) {
		const wide = DIL.useBreakpoint("sm");
		const venue = state.game.venue;
		const closed = detail ? [
			"closed",
			"complete",
			"final"
		].includes(state.game.status) : state.game.status === "closed";
		const live = ["inprogress", "halftime"].includes(state.game.status);
		const title = detail ? [detail.playoff_series_label, detail.game_title_label].filter(Boolean).join(" • ") || detail.matchup_title_label : \`\${state.game.away?.name ?? ""} vs. \${state.game.home?.name ?? ""}\`;
		const teamName = (side) => state.game[side]?.name ?? detail?.tbd_label ?? "";
		const record = (side) => detail ? detail[\`\${side}_record_label\`] : \`\${state.game[side]?.record?.wins ?? 0} - \${state.game[side]?.record?.losses ?? 0}\`;
		const score = (side, inline) => state.has_started ? /* @__PURE__ */ __dil.jsx("title", {
			size: inline ? "2xl" : "xl",
			weight: "normal"
		}, state.game[side]?.points ?? "") : null;
		const team = (side) => /* @__PURE__ */ __dil.jsx("col", {
			align: "center",
			gap: detail ? .5 : 0,
			minWidth: 0,
			flex: wide ? void 0 : 1
		}, state.game[side]?.logo_url ? /* @__PURE__ */ __dil.jsx("image", {
			src: state.game[side].logo_url,
			width: 64,
			height: 64,
			fit: "contain"
		}) : /* @__PURE__ */ __dil.jsx("box", {
			width: 64,
			height: 64
		}), !wide && score(side, false), /* @__PURE__ */ __dil.jsx("col", { align: "center" }, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			textAlign: "center"
		}, teamName(side)), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, record(side))));
		return /* @__PURE__ */ __dil.jsx("card", {
			size: "full",
			padding: 0,
			variant: "soft",
			background: "transparent",
			radius: 0
		}, /* @__PURE__ */ __dil.jsx("box", { padding: 0 }, /* @__PURE__ */ __dil.jsx("col", { gap: 1 }, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 1,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("col", {
			flex: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("title", { weight: "semibold" }, title)), onBack && /* @__PURE__ */ __dil.jsx("button", {
			label: backLabel,
			size: "sm",
			color: "secondary",
			variant: "ghost",
			uniform: true,
			onClick: onBack
		}, /* @__PURE__ */ __dil.jsx("icon", { name: "x" }))), detail ? detail.venue_text && /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, detail.venue_text) : /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, state.date_string)), /* @__PURE__ */ __dil.jsx("divider", null), /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: wide ? 0 : 2,
			padding: { x: wide ? 6 : 0 }
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			flex: 1,
			justify: "start",
			gap: 8,
			minWidth: 0
		}, team("away"), wide && /* @__PURE__ */ __dil.jsx("col", {
			height: 72,
			justify: "center"
		}, score("away", true))), /* @__PURE__ */ __dil.jsx("col", {
			justify: "center",
			align: "center",
			height: wide ? 72 : void 0,
			flex: wide ? void 0 : 1,
			minWidth: 0,
			gap: 2,
			padding: { x: wide ? 10 : 0 }
		}, closed && /* @__PURE__ */ __dil.jsx("col", { align: "center" }, /* @__PURE__ */ __dil.jsx("text", {
			textAlign: "center",
			size: "xs",
			weight: "semibold"
		}, state.final_label), detail ? /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			textAlign: "center"
		}, state.date_string) : wide ? /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("text", {
			textAlign: "center",
			size: "xs"
		}, venue?.name ?? ""), /* @__PURE__ */ __dil.jsx("text", {
			textAlign: "center",
			size: "xs"
		}, \`\${venue?.city ?? ""}, \${venue?.state ?? ""}\`)) : null), live && /* @__PURE__ */ __dil.jsx("col", {
			align: "center",
			gap: 0
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 1.5
		}, detail ? /* @__PURE__ */ __dil.jsx("pulse-indicator", { size: 8 }) : /* @__PURE__ */ __dil.jsx("box", {
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
			textAlign: "center",
			weight: "semibold",
			color: "red-400",
			size: "xs"
		}, state.live_label)), /* @__PURE__ */ __dil.jsx("text", {
			textAlign: "center",
			size: "xs"
		}, state.game.status === "halftime" ? state.halftime_label : \`\${state.clock_string} \${state.quarter_string}\`)), state.is_scheduled && !state.has_started && /* @__PURE__ */ __dil.jsx("col", { align: "center" }, /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			weight: "semibold",
			color: state.is_today ? "green" : void 0,
			textAlign: "center"
		}, state.date_string), /* @__PURE__ */ __dil.jsx("text", {
			textAlign: "center",
			size: "xs"
		}, state.time_string), !detail && wide && /* @__PURE__ */ __dil.jsx("text", {
			textAlign: "center",
			size: "xs"
		}, \`\${venue?.city ?? ""}, \${venue?.state ?? ""}\`))), /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			flex: 1,
			justify: "end",
			gap: 8,
			minWidth: 0
		}, wide && /* @__PURE__ */ __dil.jsx("col", {
			height: 72,
			justify: "center"
		}, score("home", true)), team("home"))), !wide && !detail && (closed || state.is_scheduled) && /* @__PURE__ */ __dil.jsx("col", {
			align: "center",
			padding: { top: 2 }
		}, venue?.name && /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary",
			textAlign: "center"
		}, venue.name), (venue?.city || venue?.state) && /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary",
			textAlign: "center"
		}, [venue?.city, venue?.state].filter(Boolean).join(", "))), state.has_started && /* @__PURE__ */ __dil.jsx("box", { padding: { y: 3 } }, /* @__PURE__ */ __dil.jsx("table", null, /* @__PURE__ */ __dil.jsx("table-row", null, /* @__PURE__ */ __dil.jsx("table-cell", { width: detail ? "40%" : void 0 }, /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary"
		}, state.team_label)), /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, state.scoring_periods.map((period, index) => /* @__PURE__ */ __dil.jsx(ScoreCell, {
			key: index,
			value: period.label,
			header: true
		})))), /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, ["away", "home"].map((side) => /* @__PURE__ */ __dil.jsx("table-row", { key: side }, /* @__PURE__ */ __dil.jsx("table-cell", { width: detail ? "40%" : void 0 }, /* @__PURE__ */ __dil.jsx("row", { align: "center" }, state.game[side]?.logo_url ? /* @__PURE__ */ __dil.jsx("image", {
			src: state.game[side].logo_url,
			width: 20,
			height: 20,
			fit: "contain"
		}) : /* @__PURE__ */ __dil.jsx("box", {
			width: 20,
			height: 20
		}), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium"
		}, teamName(side)))), /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, state.scoring_periods.map((period, index) => /* @__PURE__ */ __dil.jsx(ScoreCell, {
			key: index,
			value: period[\`\${side}_points\`]
		}))))))))));
	}
	function ScoreCell({ value, header = false }) {
		return /* @__PURE__ */ __dil.jsx("table-cell", { align: "center" }, /* @__PURE__ */ __dil.jsx("text", {
			size: header ? "xs" : "sm",
			color: header ? "secondary" : void 0
		}, value));
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
//#region NbaScores.dil.tsx
	function NbaScores(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("NbaScores", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 320
		});
		return /* @__PURE__ */ __dil.jsx(Scores, { state });
	}
	function Scores({ state }) {
		const wide = DIL.useBreakpoint("md");
		const [expanded, setExpanded] = DIL.useState(false);
		const [activeId, setActiveId] = DIL.useState(state.default_active_game_id);
		if (activeId != null) {
			const active = state.boxscores.find((item) => item.game.id === activeId);
			return active ? /* @__PURE__ */ __dil.jsx(NbaBoxscore, {
				state: active,
				detail: active,
				backLabel: state.back_to_scores_label,
				onBack: state.game_count > 1 ? () => setActiveId(null) : void 0
			}) : null;
		}
		if (!state.rows.length) return null;
		const rows = expanded ? state.rows : state.rows.slice(0, 2);
		return /* @__PURE__ */ __dil.jsx("card", {
			size: "full",
			padding: 0,
			variant: "soft",
			background: "transparent",
			radius: 0
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: 4,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("col", { gap: 1 }, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 1.5,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("image", {
			src: state.league_logo_url,
			height: 20,
			fit: "contain",
			hideOnFailure: true
		}), /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium"
		}, state.league_name), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, "•"), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, state.season_label))), /* @__PURE__ */ __dil.jsx("title", {
			size: "md",
			weight: "semibold"
		}, state.title)), /* @__PURE__ */ __dil.jsx("col", {
			align: "center",
			gap: 6
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: 3,
			width: "100%"
		}, rows.map((row, rowIndex) => /* @__PURE__ */ __dil.jsx("col", {
			key: row.key,
			gap: 0
		}, /* @__PURE__ */ __dil.jsx("grid", {
			columns: wide ? 2 : 1,
			gap: wide ? 10 : 4
		}, row.games.map((entry, index) => /* @__PURE__ */ __dil.jsx("grid-item", { key: entry.key }, entry.game && /* @__PURE__ */ __dil.jsx("pressable", {
			width: "100%",
			padding: {
				x: 2,
				y: 1
			},
			radius: "md",
			onClick: () => setActiveId(entry.game.game_id)
		}, /* @__PURE__ */ __dil.jsx(ScoreGame, { game: entry.game })), !wide && index === 0 && row.games[1]?.game != null && /* @__PURE__ */ __dil.jsx("divider", null)))), row.showDivider && rowIndex !== rows.length - 1 && /* @__PURE__ */ __dil.jsx("divider", { spacing: 2 })))), state.rows.length > 2 && /* @__PURE__ */ __dil.jsx("button", {
			variant: "outline",
			size: "lg",
			block: true,
			onClick: () => setExpanded(!expanded)
		}, expanded ? state.show_less_label : state.show_more_label))));
	}
	function ScoreGame({ game }) {
		return /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			justify: "between",
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: 0,
			flex: 1,
			minWidth: 0
		}, game.teams.map((team, index) => /* @__PURE__ */ __dil.jsx("row", {
			key: team.key ?? index,
			align: "center",
			gap: 1
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: 26,
			height: 26,
			align: "center",
			justify: "center"
		}, team.logo ? /* @__PURE__ */ __dil.jsx("image", {
			src: team.logo,
			width: 26,
			height: 26,
			fit: "contain",
			hideOnFailure: true
		}) : /* @__PURE__ */ __dil.jsx("box", {
			width: 14,
			height: 14,
			radius: "sm",
			background: "gray-200"
		})), team.seed != null && /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary"
		}, team.seed), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: team.winner ? "semibold" : "medium"
		}, team.name), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: team.winner ? "semibold" : "medium"
		}, team.hasScore ? "•" : ""), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: team.winner ? "semibold" : "medium"
		}, team.hasScore ? team.score : "")))), /* @__PURE__ */ __dil.jsx("col", {
			justify: "end",
			gap: 0,
			minWidth: 80
		}, game.liveBadge ? /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("row", {
			gap: 1.2,
			justify: "end",
			height: 26,
			align: "center"
		}, /* @__PURE__ */ __dil.jsx("pulse-indicator", { size: 8 }), /* @__PURE__ */ __dil.jsx("text", {
			weight: "semibold",
			color: "red-400",
			size: "sm"
		}, game.liveLabel)), /* @__PURE__ */ __dil.jsx("row", {
			height: 26,
			align: "center",
			justify: "end"
		}, /* @__PURE__ */ __dil.jsx("text", {
			textAlign: "end",
			size: "sm",
			color: "secondary"
		}, game.liveDetail))) : /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("row", {
			height: 26,
			align: "center",
			justify: "end"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			textAlign: "end"
		}, game.primaryLabel)), /* @__PURE__ */ __dil.jsx("row", {
			height: 26,
			align: "center",
			justify: "end"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary",
			textAlign: "end"
		}, game.secondaryLabel)))));
	}

//#endregion
return NbaScores;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=nba-scores-widget-db8543fc9789.js.map