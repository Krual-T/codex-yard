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
//#region CricketSingleMatch.dil.tsx
	function CricketSingleMatch(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("CricketSingleMatch", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 440
		});
		return /* @__PURE__ */ __dil.jsx(Cricket, { state });
	}
	function TeamLogo({ team }) {
		return team.logo_url ? /* @__PURE__ */ __dil.jsx("image", {
			src: team.logo_url,
			width: 56,
			height: 56,
			fit: "contain"
		}) : /* @__PURE__ */ __dil.jsx("box", {
			width: 56,
			height: 56,
			radius: "xl",
			background: "gray-200",
			align: "center",
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			weight: "semibold",
			textAlign: "center"
		}, team.alias || team.name));
	}
	function Score({ team, show }) {
		return /* @__PURE__ */ __dil.jsx("col", {
			justify: "center",
			align: "center",
			gap: 0,
			width: 118,
			minHeight: 60
		}, /* @__PURE__ */ __dil.jsx("title", {
			size: "2xl",
			weight: "normal"
		}, show ? team.score_main : ""), /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary"
		}, show ? team.overs_text ?? "" : ""));
	}
	function Stats({ heading, labels, rows, bowling = false, scorecard = false }) {
		const columns = bowling ? [
			{
				field: "overs",
				label: labels.overs
			},
			{
				field: "maidens",
				label: labels.maidens
			},
			{
				field: "runs",
				label: labels.runs
			},
			{
				field: "wickets",
				label: labels.wickets
			},
			{
				field: scorecard ? "economy" : "econ",
				label: labels.economy
			}
		] : [
			{
				field: "runs",
				label: labels.runs
			},
			{
				field: "balls",
				label: labels.balls
			},
			{
				field: "fours",
				label: labels.fours
			},
			{
				field: "sixes",
				label: labels.sixes
			},
			{
				field: scorecard ? "strike_rate" : "sr",
				label: labels.strike_rate
			}
		];
		return /* @__PURE__ */ __dil.jsx("table", null, [/* @__PURE__ */ __dil.jsx("table-row", null, [/* @__PURE__ */ __dil.jsx("table-cell", {
			vAlign: "center",
			width: "40%"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary"
		}, heading)), ...columns.map((column) => /* @__PURE__ */ __dil.jsx("table-cell", {
			vAlign: "center",
			width: "12%",
			align: "center"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary"
		}, column.label)))]), ...rows.map((row) => /* @__PURE__ */ __dil.jsx("table-row", null, [/* @__PURE__ */ __dil.jsx("table-cell", {
			vAlign: "center",
			width: "40%"
		}, /* @__PURE__ */ __dil.jsx("row", {
			gap: row.is_striker ? 2 : 1,
			align: "center"
		}, /* @__PURE__ */ __dil.jsx("text", { size: "sm" }, row.name), row.is_striker && /* @__PURE__ */ __dil.jsx("text", { size: "sm" }, "•"), row.team_alias && row.team_alias !== "-" && /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, \`(\${row.team_alias})\`))), ...columns.map((column) => /* @__PURE__ */ __dil.jsx("table-cell", {
			vAlign: "center",
			width: "12%",
			align: "center"
		}, /* @__PURE__ */ __dil.jsx("text", { size: "sm" }, row[column.field])))]))]);
	}
	function Cricket({ state }) {
		const wide = DIL.useBreakpoint("sm");
		const [tab, setTab] = DIL.useState(state.tab ?? "primary");
		const [scoreSide, setScoreSide] = DIL.useState(state.score_side ?? state.scorecard_first_side);
		const labels = state.labels;
		const left = state.left_display;
		const right = state.right_display;
		const currentOutcomes = state.current_over_outcomes?.slice(-6) ?? [];
		return /* @__PURE__ */ __dil.jsx("card", {
			size: "full",
			padding: 0,
			variant: "soft",
			background: "transparent",
			radius: 0
		}, /* @__PURE__ */ __dil.jsx("box", { padding: 0 }, /* @__PURE__ */ __dil.jsx("col", { gap: 1 }, /* @__PURE__ */ __dil.jsx("title", { weight: "semibold" }, state.title), state.venue_text != null && /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, state.venue_text)), /* @__PURE__ */ __dil.jsx("divider", null), /* @__PURE__ */ __dil.jsx("row", {
			align: "stretch",
			gap: 0,
			padding: { x: wide ? 6 : 1 }
		}, /* @__PURE__ */ __dil.jsx("box", {
			direction: wide ? "row" : "col",
			align: "center",
			gap: 2,
			justify: "start",
			flex: 1
		}, /* @__PURE__ */ __dil.jsx("col", {
			align: "center",
			gap: 2,
			padding: { top: 2 }
		}, /* @__PURE__ */ __dil.jsx(TeamLogo, { team: left }), wide && /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			textAlign: "center"
		}, left.name)), (wide || state.show_scores) && /* @__PURE__ */ __dil.jsx(Score, {
			team: left,
			show: state.show_scores
		}), !wide && /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			textAlign: "center"
		}, left.name)), /* @__PURE__ */ __dil.jsx("col", {
			align: "center",
			gap: 0,
			width: 108,
			justify: "center"
		}, state.is_live && /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 1.5
		}, /* @__PURE__ */ __dil.jsx("pulse-indicator", { size: 8 }), /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			weight: "semibold",
			color: "red-400"
		}, labels.live)), state.is_final && /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			weight: "semibold"
		}, labels.final), /* @__PURE__ */ __dil.jsx("text", { size: "xs" }, state.scheduled_date_text)), !state.is_live && !state.is_final && /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			weight: "semibold"
		}, state.scheduled_date_text), /* @__PURE__ */ __dil.jsx("text", { size: "xs" }, state.scheduled_time_text))), /* @__PURE__ */ __dil.jsx("box", {
			direction: wide ? "row" : "col",
			align: wide ? "stretch" : "center",
			gap: 2,
			flex: 1,
			justify: wide ? "end" : "start"
		}, wide && /* @__PURE__ */ __dil.jsx(Score, {
			team: right,
			show: state.show_scores
		}), /* @__PURE__ */ __dil.jsx("col", {
			align: "center",
			gap: 2,
			padding: { top: 2 }
		}, /* @__PURE__ */ __dil.jsx(TeamLogo, { team: right }), wide && /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			textAlign: "center"
		}, right.name)), !wide && /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, state.show_scores && /* @__PURE__ */ __dil.jsx(Score, {
			team: right,
			show: state.show_scores
		}), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			textAlign: "center"
		}, right.name)))), !state.is_final && /* @__PURE__ */ __dil.jsx("col", {
			gap: 1,
			padding: { top: 2 }
		}, state.status_text && /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary",
			textAlign: "center"
		}, state.status_text)), state.is_final && state.final_result_text != null && /* @__PURE__ */ __dil.jsx("text", {
			color: "secondary",
			size: "sm",
			textAlign: "center"
		}, state.final_result_text), (state.is_live || state.is_final) && /* @__PURE__ */ __dil.jsx("box", { padding: { top: 6 } }, /* @__PURE__ */ __dil.jsx("segmented-control", {
			options: [
				{
					value: "primary",
					label: state.is_live ? labels.live : state.is_final ? labels.recap : labels.scorecard
				},
				{
					value: "scorecard",
					label: labels.scorecard
				},
				{
					value: "timeline",
					label: labels.timeline
				},
				{
					value: "run_rate",
					label: labels.run_rate
				}
			],
			value: tab,
			onChange: setTab,
			variant: "soft",
			pill: true,
			block: true,
			size: "xs"
		}), tab === "primary" && state.is_live && /* @__PURE__ */ __dil.jsx("col", {
			gap: 3,
			padding: { top: 2 }
		}, state.is_innings_break && state.innings_break_chase_text && /* @__PURE__ */ __dil.jsx("row", {
			gap: 1,
			align: "center"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, labels.innings_break), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, "•"), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, state.innings_break_chase_text)), state.current_over_outcomes != null && /* @__PURE__ */ __dil.jsx("col", { gap: 1 }, /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary"
		}, state.is_innings_break ? labels.last_over : labels.current_over), /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 1,
			justify: "start"
		}, [
			0,
			1,
			2,
			3,
			4,
			5
		].map((index) => /* @__PURE__ */ __dil.jsx("box", {
			key: index,
			width: 40,
			height: 40,
			border: {
				size: 1,
				color: "subtle"
			},
			radius: "sm",
			align: "center",
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			weight: "semibold",
			textAlign: "center"
		}, currentOutcomes[index] ?? ""))))), !state.is_innings_break && state.batters_live?.length > 0 && /* @__PURE__ */ __dil.jsx(Stats, {
			heading: labels.batters,
			labels,
			rows: state.batters_live
		}), !state.is_innings_break && state.current_bowler_live && /* @__PURE__ */ __dil.jsx("col", { gap: 1 }, /* @__PURE__ */ __dil.jsx(Stats, {
			heading: labels.bowlers,
			labels,
			rows: [state.current_bowler_live],
			bowling: true
		}))), tab === "primary" && !state.is_live && state.is_final && /* @__PURE__ */ __dil.jsx("col", {
			gap: 3,
			padding: { top: 2 }
		}, state.recap_batters?.length > 0 && /* @__PURE__ */ __dil.jsx("col", { gap: 1 }, /* @__PURE__ */ __dil.jsx(Stats, {
			heading: labels.top_batters,
			labels,
			rows: state.recap_batters
		})), state.recap_bowlers?.length > 0 && /* @__PURE__ */ __dil.jsx("col", { gap: 1 }, /* @__PURE__ */ __dil.jsx(Stats, {
			heading: labels.top_bowlers,
			labels,
			rows: state.recap_bowlers,
			bowling: true
		}))), tab === "scorecard" && /* @__PURE__ */ __dil.jsx("col", {
			gap: 2,
			padding: { top: 2 }
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 4
		}, [state.scorecard_first_side, state.scorecard_second_side].map((side) => /* @__PURE__ */ __dil.jsx("pressable", {
			key: side,
			onClick: () => setScoreSide(side),
			border: scoreSide === side ? { bottom: 1 } : void 0,
			padding: .5
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: scoreSide === side ? "bold" : "normal"
		}, side === "away" ? state.away_display.name : state.home_display.name)))), /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, (state.scorecards_by_side[scoreSide] ?? []).map((innings, index) => /* @__PURE__ */ __dil.jsx("col", {
			key: index,
			gap: 2
		}, innings.batting_rows?.length > 0 && /* @__PURE__ */ __dil.jsx(Stats, {
			heading: innings.batters_header,
			labels,
			rows: innings.batting_rows,
			scorecard: true
		}), innings.bowling_rows?.length > 0 && /* @__PURE__ */ __dil.jsx(Stats, {
			heading: innings.bowlers_header,
			labels,
			rows: innings.bowling_rows,
			bowling: true,
			scorecard: true
		}))))), tab === "timeline" && /* @__PURE__ */ __dil.jsx("col", {
			padding: { top: 2 },
			gap: 3
		}, /* @__PURE__ */ __dil.jsx("col", {
			height: 260,
			scrollable: true,
			gap: 3
		}, state.timeline_groups.map((group, index) => /* @__PURE__ */ __dil.jsx("col", {
			key: index,
			gap: 1
		}, group.inning_section_label && /* @__PURE__ */ __dil.jsx("box", { padding: { bottom: 1 } }, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "semibold"
		}, group.inning_section_label)), /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary"
		}, group.summary_text), /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, group.balls.map((ball, ballIndex) => /* @__PURE__ */ __dil.jsx("row", {
			key: ballIndex,
			gap: 2,
			align: "center",
			padding: { y: 2 }
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: 30,
			minWidth: 30,
			maxWidth: 30
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary",
			width: "100%",
			textAlign: "end"
		}, ball.display_overs ?? "-")), /* @__PURE__ */ __dil.jsx("box", {
			width: 32,
			height: 32,
			radius: "sm",
			border: {
				size: 1,
				color: "subtle"
			},
			align: "center",
			justify: "center",
			padding: 0
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			textAlign: "center",
			width: "100%",
			color: ball.is_wicket ? "red-400" : void 0,
			weight: "semibold"
		}, ball.outcome_short)), /* @__PURE__ */ __dil.jsx("col", {
			gap: 0,
			padding: { left: 2 }
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary"
		}, ball.ball_summary_text), ball.outcome_long && /* @__PURE__ */ __dil.jsx("text", { size: "sm" }, ball.outcome_long))))), /* @__PURE__ */ __dil.jsx("divider", null))))), tab === "run_rate" && /* @__PURE__ */ __dil.jsx("col", {
			padding: { top: 2 },
			gap: 2
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 4
		}, state.is_live && state.run_rate_summary.current_rr != null && /* @__PURE__ */ __dil.jsx("text", { size: "sm" }, \`\${labels.current_rr}: \${state.run_rate_summary.current_rr}\`), state.is_live && state.run_rate_summary.required_rr != null && /* @__PURE__ */ __dil.jsx("text", { size: "sm" }, \`\${labels.required_rr}: \${state.run_rate_summary.required_rr}\`)), /* @__PURE__ */ __dil.jsx("chart", {
			data: state.run_rate_chart_data,
			series: [{
				type: "line",
				dataKey: "away_runs",
				label: state.away_display.alias,
				color: state.away_display.color
			}, {
				type: "line",
				dataKey: "home_runs",
				label: state.home_display.alias,
				color: state.home_display.color
			}],
			xAxis: {
				dataKey: "over",
				type: "number"
			},
			yAxis: {},
			showYAxis: true,
			height: 180,
			showLegend: true,
			showTooltip: true,
			showGrid: true,
			showDots: true,
			showHoverDots: true
		})))));
	}

//#endregion
return CricketSingleMatch;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=cricket-match-boxscore-widget-5c4c62879df3.js.map