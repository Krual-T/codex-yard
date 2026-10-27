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
//#region internal/SportsDetails.dil.tsx
	function SportsTableCell({ children }) {
		return /* @__PURE__ */ __dil.jsx("table-cell", { align: "center" }, children);
	}
	function PlayerStatsTable({ category }) {
		const statColumnWidth = Math.max(64, ...category.column_labels.map((label) => label.length * 10 + 16));
		return /* @__PURE__ */ __dil.jsx("box", {
			direction: "row",
			scrollable: true,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			minWidth: 160 + category.column_labels.length * statColumnWidth
		}, /* @__PURE__ */ __dil.jsx("table", { columnSizing: "equal" }, /* @__PURE__ */ __dil.jsx("table-row", null, /* @__PURE__ */ __dil.jsx("table-cell", { width: 160 }, /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary"
		}, category.header)), /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, category.column_labels.map((label, index) => /* @__PURE__ */ __dil.jsx(SportsTableCell, { key: index }, /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary"
		}, label))))), /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, category.players.map((player, index) => /* @__PURE__ */ __dil.jsx("table-row", { key: index }, /* @__PURE__ */ __dil.jsx("table-cell", { width: 160 }, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium"
		}, player.name)), /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, player.stats.map((value, statIndex) => /* @__PURE__ */ __dil.jsx(SportsTableCell, { key: statIndex }, /* @__PURE__ */ __dil.jsx("text", { size: "sm" }, value))))))))));
	}
	function SportsStats({ stats, leftSide, leftName, rightName, homeColor, awayColor, height, secondaryLabel }) {
		return /* @__PURE__ */ __dil.jsx("col", { gap: 4 }, /* @__PURE__ */ __dil.jsx("row", {
			justify: "between",
			align: "center"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium"
		}, leftName), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium"
		}, rightName)), /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, stats.map((stat) => /* @__PURE__ */ __dil.jsx("col", {
			key: stat.key,
			gap: 1
		}, /* @__PURE__ */ __dil.jsx("row", {
			justify: "between",
			align: "center"
		}, /* @__PURE__ */ __dil.jsx("text", { size: "sm" }, leftSide === "home" ? stat.home_value : stat.away_value), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: secondaryLabel ? "secondary" : void 0
		}, stat.label), /* @__PURE__ */ __dil.jsx("text", { size: "sm" }, leftSide === "home" ? stat.away_value : stat.home_value)), /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 1,
			width: "100%"
		}, stat.both_zero ? /* @__PURE__ */ __dil.jsx("box", {
			radius: "lg",
			background: "gray-200",
			height,
			width: "100%"
		}) : /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("box", {
			radius: "lg",
			background: leftSide === "home" ? homeColor : awayColor,
			height,
			flex: leftSide === "home" ? stat.home_pct : stat.away_pct
		}), /* @__PURE__ */ __dil.jsx("box", {
			radius: "lg",
			background: leftSide === "home" ? awayColor : homeColor,
			height,
			flex: leftSide === "home" ? stat.away_pct : stat.home_pct
		})))))));
	}

//#endregion
//#region SoccerGames.dil.tsx
	function SoccerGames(props) {
		const { resolutionComplete, state } = useResolvedComponentResult("SoccerGames", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 320
		});
		return /* @__PURE__ */ __dil.jsx(SoccerView, { state });
	}
	function TeamImage({ team, useFlags, size }) {
		const hasImage = useFlags && !!team.flag_icon_url || !!team.logo_url;
		const showEmoji = (!useFlags || !team.flag_icon_url) && !!team.flag_emoji;
		const showPlaceholder = !team.logo_url && (useFlags && !team.flag_icon_url || !useFlags && !team.flag_emoji);
		const fallback = /* @__PURE__ */ __dil.jsx("box", {
			width: size,
			height: size,
			radius: "xl",
			background: "gray-200",
			align: "center",
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			weight: "semibold",
			textAlign: "center"
		}, team.alias || team.name));
		return /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, hasImage && /* @__PURE__ */ __dil.jsx("image", {
			src: team.logo_url || team.flag_icon_url || "",
			alt: team.name,
			width: size,
			height: size,
			fit: "contain",
			radius: "none",
			hideOnFailure: true,
			fallback
		}), showEmoji && /* @__PURE__ */ __dil.jsx("title", {
			size: size === 56 ? "3xl" : "2xl",
			weight: "normal",
			maxLines: 1
		}, team.flag_emoji), showPlaceholder && fallback);
	}
	function SoccerStatus({ item, compact = false }) {
		const date = compact ? item.compact_scheduled_date_text : item.scheduled_date_text;
		return /* @__PURE__ */ __dil.jsx("col", {
			justify: "center",
			align: "center",
			width: compact ? void 0 : 108,
			minHeight: compact ? void 0 : 72,
			gap: 0
		}, item.is_live && /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: compact ? 1.2 : 1.5
		}, /* @__PURE__ */ __dil.jsx("pulse-indicator", { size: 8 }), /* @__PURE__ */ __dil.jsx("text", {
			textAlign: "center",
			size: "xs",
			weight: "semibold",
			color: "red-400"
		}, item.status_label)), item.live_detail !== "" && /* @__PURE__ */ __dil.jsx("text", {
			textAlign: "center",
			size: "xs"
		}, item.live_detail)), item.is_final && /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("text", {
			textAlign: "center",
			size: "xs",
			weight: "semibold"
		}, item.status_label), /* @__PURE__ */ __dil.jsx("text", {
			textAlign: "center",
			size: "xs"
		}, date)), !item.is_live && !item.is_final && (item.status_label !== "" ? /* @__PURE__ */ __dil.jsx("text", {
			textAlign: "center",
			size: "xs",
			weight: "semibold"
		}, item.status_label) : /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("text", {
			textAlign: "center",
			size: "xs",
			weight: "semibold"
		}, date), /* @__PURE__ */ __dil.jsx("text", {
			textAlign: "center",
			size: "xs"
		}, item.scheduled_time_text))), compact && item.compact_penalty_result_label != null && /* @__PURE__ */ __dil.jsx("text", {
			textAlign: "center",
			size: "xs",
			color: "secondary"
		}, item.compact_penalty_result_label));
	}
	function SoccerTeamName({ team }) {
		return /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			textAlign: "center"
		}, team.name), team.record_label !== "" && /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary",
			textAlign: "center"
		}, team.record_label));
	}
	function SoccerTeamHeader({ item, side, wide, useFlags }) {
		const team = item[side];
		const score = /* @__PURE__ */ __dil.jsx("col", {
			justify: "center",
			align: "center",
			gap: 0,
			width: 64,
			minHeight: wide ? 60 : 40
		}, /* @__PURE__ */ __dil.jsx("title", {
			size: "2xl",
			weight: "normal"
		}, item.show_scores ? team.score_label : ""));
		return /* @__PURE__ */ __dil.jsx("box", {
			direction: wide ? "row" : "col",
			align: side === "away" && wide ? "stretch" : "center",
			gap: wide ? 2 : 1,
			flex: 1,
			justify: side === "away" && wide ? "end" : "start"
		}, wide && side === "away" && score, /* @__PURE__ */ __dil.jsx("col", {
			align: "center",
			gap: 1
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: 72,
			height: wide ? 72 : 64,
			align: "center",
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx(TeamImage, {
			team,
			useFlags,
			size: 56
		})), wide && /* @__PURE__ */ __dil.jsx(SoccerTeamName, { team })), (side === "home" && (wide || item.show_scores) || side === "away" && !wide && item.show_scores) && score, !wide && /* @__PURE__ */ __dil.jsx("col", {
			align: "center",
			gap: 0
		}, /* @__PURE__ */ __dil.jsx(SoccerTeamName, { team })));
	}
	function SoccerScoreboard({ item, useFlags }) {
		const wide = DIL.useBreakpoint("sm");
		return /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("row", {
			align: "stretch",
			gap: 0,
			padding: { x: wide ? 3 : 1 }
		}, /* @__PURE__ */ __dil.jsx(SoccerTeamHeader, {
			item,
			side: "home",
			wide,
			useFlags
		}), /* @__PURE__ */ __dil.jsx(SoccerStatus, { item }), /* @__PURE__ */ __dil.jsx(SoccerTeamHeader, {
			item,
			side: "away",
			wide,
			useFlags
		})), item.penalty_result_label != null && /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary",
			textAlign: "center"
		}, item.penalty_result_label));
	}
	function SoccerIncidents({ item }) {
		if (item.incident_groups.length === 0) return null;
		return /* @__PURE__ */ __dil.jsx("col", {
			gap: 4,
			padding: { top: 3 },
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, item.incident_groups.map((group) => /* @__PURE__ */ __dil.jsx("row", {
			key: group.key,
			gap: 2,
			width: "100%",
			align: "start"
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: 3,
			flex: 1,
			minWidth: 0,
			align: "end",
			padding: { top: .5 }
		}, /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, group.home.map((incident, index) => /* @__PURE__ */ __dil.jsx("box", {
			key: index,
			width: "100%",
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			textAlign: "end",
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("text", { inline: true }, incident.description), /* @__PURE__ */ __dil.jsx("text", {
			inline: true,
			color: "secondary"
		}, incident.time_label !== "" ? \` \${incident.time_label}\` : "")))))), /* @__PURE__ */ __dil.jsx("box", {
			width: 44,
			minWidth: 44,
			align: "center",
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("text", { size: "sm" }, group.icon)), /* @__PURE__ */ __dil.jsx("col", {
			gap: 3,
			flex: 1,
			minWidth: 0,
			align: "start",
			padding: { top: .5 }
		}, /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, group.away.map((incident, index) => /* @__PURE__ */ __dil.jsx("box", {
			key: index,
			width: "100%",
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("text", { inline: true }, incident.description), /* @__PURE__ */ __dil.jsx("text", {
			inline: true,
			color: "secondary"
		}, incident.time_label !== "" ? \` \${incident.time_label}\` : ""))))))))));
	}
	function SoccerTabs({ item }) {
		const [detailTab, setDetailTab] = DIL.useState(null);
		const [playerSide, setPlayerSide] = DIL.useState("home");
		const tab = detailTab != null && item.detail_tab_values.includes(detailTab) ? detailTab : item.default_detail_tab;
		if (item.detail_tabs.length === 0) return null;
		return /* @__PURE__ */ __dil.jsx("box", { gap: 0 }, /* @__PURE__ */ __dil.jsx("box", {
			gap: 0,
			padding: {
				top: 2,
				bottom: 3
			}
		}, /* @__PURE__ */ __dil.jsx("divider", { spacing: 0 })), /* @__PURE__ */ __dil.jsx("col", {
			gap: 0,
			padding: { bottom: 4 }
		}, item.detail_tabs.length === 1 ? /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "semibold"
		}, item.detail_tabs[0]?.label) : /* @__PURE__ */ __dil.jsx("box", {
			minWidth: 0,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("segmented-control", {
			options: item.detail_tabs,
			value: tab,
			onChange: setDetailTab,
			variant: "ghost",
			size: "md",
			pill: true
		}))), tab === "win_probability" && /* @__PURE__ */ __dil.jsx("col", { gap: 3 }, /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, item.win_probabilities.map((probability) => /* @__PURE__ */ __dil.jsx("col", {
			key: probability.key,
			gap: 1
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, \`\${probability.label} • \${probability.percentage_label}\`), /* @__PURE__ */ __dil.jsx("box", {
			width: \`\${probability.percentage}%\`,
			height: 8,
			radius: "lg",
			background: probability.color
		})))), /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "tertiary"
		}, item.win_probability_attribution)), tab === "team_stats" && /* @__PURE__ */ __dil.jsx(SportsStats, {
			stats: item.team_stats,
			leftSide: "home",
			leftName: item.home.name,
			rightName: item.away.name,
			homeColor: item.home.primary_color ?? "#000000",
			awayColor: item.away.primary_color ?? "#000000",
			height: 8
		}), tab === "player_stats" && /* @__PURE__ */ __dil.jsx("col", { gap: 3 }, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 4
		}, /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, ["home", "away"].map((side) => /* @__PURE__ */ __dil.jsx("pressable", {
			key: side,
			padding: .5,
			border: playerSide === side ? { bottom: 1 } : {},
			onClick: () => setPlayerSide(side)
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: playerSide === side ? "bold" : void 0
		}, item[side].name))))), /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, item.player_stats_by_side[playerSide].map((category) => /* @__PURE__ */ __dil.jsx(PlayerStatsTable, {
			key: category.key,
			category
		})))), tab === "timeline" && /* @__PURE__ */ __dil.jsx("col", {
			height: 300,
			scrollable: true,
			gap: 1
		}, /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, item.timeline.map((event, index) => /* @__PURE__ */ __dil.jsx("col", {
			key: index,
			gap: 1
		}, event.time_label !== "" && /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary"
		}, event.time_label), /* @__PURE__ */ __dil.jsx("text", { size: "sm" }, event.commentary), index !== item.timeline.length - 1 && /* @__PURE__ */ __dil.jsx("divider", null))))));
	}
	function SoccerCard({ item, state, expanded, onClose }) {
		return /* @__PURE__ */ __dil.jsx("card", {
			size: "full",
			padding: 0,
			variant: "soft",
			background: "transparent",
			radius: 0
		}, /* @__PURE__ */ __dil.jsx("box", { padding: 0 }, /* @__PURE__ */ __dil.jsx("col", { gap: 1 }, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			justify: "between",
			gap: 1,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("title", { weight: "semibold" }, item.title), expanded && !state.auto_expand_single_game && /* @__PURE__ */ __dil.jsx("pressable", {
			ariaLabel: state.back_to_games_label,
			onClick: onClose,
			width: 28,
			height: 28,
			align: "center",
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: "x",
			color: "secondary"
		})), !expanded && item.has_detail_content && /* @__PURE__ */ __dil.jsx("icon", {
			name: "maximize-2",
			size: "sm",
			color: "secondary"
		})), item.venue_text !== "" && /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, item.venue_text)), /* @__PURE__ */ __dil.jsx("box", {
			gap: 0,
			padding: { top: 2 }
		}, /* @__PURE__ */ __dil.jsx("divider", { spacing: 0 })), /* @__PURE__ */ __dil.jsx(SoccerScoreboard, {
			item,
			useFlags: state.use_flag_icons
		}), expanded && /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx(SoccerIncidents, { item }), /* @__PURE__ */ __dil.jsx(SoccerTabs, {
			key: item.id,
			item
		}))));
	}
	function SoccerListTeam({ item, side, wide, useFlags }) {
		const team = item[side];
		const score = /* @__PURE__ */ __dil.jsx("col", {
			align: "center",
			justify: "center",
			width: 32,
			height: 48
		}, /* @__PURE__ */ __dil.jsx("title", {
			size: "xl",
			weight: "normal"
		}, team.score_label));
		return /* @__PURE__ */ __dil.jsx("col", {
			align: "stretch",
			gap: 0,
			flex: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "start",
			width: "100%",
			gap: 3,
			justify: side === "home" ? "start" : "end"
		}, wide && item.show_scores && side === "away" && score, /* @__PURE__ */ __dil.jsx("col", {
			align: "center",
			gap: 0,
			width: "100%",
			maxWidth: 128,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: 52,
			height: 48,
			align: "center",
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx(TeamImage, {
			team,
			useFlags,
			size: 36
		})), !wide && item.show_scores && /* @__PURE__ */ __dil.jsx("title", {
			size: "xl",
			weight: "normal"
		}, team.score_label), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			textAlign: "center",
			width: "100%"
		}, team.name), team.record_label !== "" && /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary"
		}, team.record_label)), wide && item.show_scores && side === "home" && score));
	}
	function SoccerView({ state }) {
		const liveActivity = useIsLiveActivity();
		const wide = DIL.useBreakpoint("sm");
		const [activeGameId, setActiveGameId] = DIL.useState(null);
		if (liveActivity) {
			if (state.games.length === 0) return null;
			const game = activeGameId != null ? state.games.find((item) => item.id === activeGameId) : state.games.find((item) => item.is_live) ?? state.games[0];
			return /* @__PURE__ */ __dil.jsx("box", {
				width: "100%",
				padding: 2,
				theme: "dark",
				background: "surface"
			}, game && /* @__PURE__ */ __dil.jsx("col", {
				gap: .5,
				width: "100%"
			}, /* @__PURE__ */ __dil.jsx("row", {
				align: "center",
				justify: "between",
				width: "100%",
				gap: 2
			}, /* @__PURE__ */ __dil.jsx("text", {
				size: "xs",
				color: "secondary",
				truncate: true
			}, game.title), /* @__PURE__ */ __dil.jsx("text", {
				size: "xs",
				weight: "medium",
				truncate: true
			}, game.status_label || \`\${game.compact_scheduled_date_text}\${game.scheduled_time_text !== "" ? \` • \${game.scheduled_time_text}\` : ""}\`)), /* @__PURE__ */ __dil.jsx("row", {
				align: "center",
				justify: "between",
				width: "100%",
				gap: 2
			}, /* @__PURE__ */ __dil.jsx("title", {
				size: "sm",
				truncate: true
			}, game.home.alias || game.home.name), /* @__PURE__ */ __dil.jsx("text", {
				size: "sm",
				weight: "semibold"
			}, game.show_scores ? \`\${game.home.score_label} - \${game.away.score_label}\` : "vs"), /* @__PURE__ */ __dil.jsx("title", {
				size: "sm",
				truncate: true
			}, game.away.alias || game.away.name))));
		}
		if (state.auto_expand_single_game || activeGameId != null) return /* @__PURE__ */ __dil.jsx("col", { gap: 0 }, /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, state.games.filter((item) => state.auto_expand_single_game || item.id === activeGameId).map((item) => /* @__PURE__ */ __dil.jsx(SoccerCard, {
			key: item.id,
			item,
			state,
			expanded: true,
			onClose: () => setActiveGameId(null)
		}))));
		if (state.game_count === 1) return /* @__PURE__ */ __dil.jsx("col", { gap: 0 }, /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, state.games.map((item) => /* @__PURE__ */ __dil.jsx("pressable", {
			key: item.id,
			width: "100%",
			radius: "md",
			disabled: !item.has_detail_content,
			onClick: () => setActiveGameId(item.id)
		}, /* @__PURE__ */ __dil.jsx(SoccerCard, {
			item,
			state,
			expanded: false,
			onClose: () => setActiveGameId(null)
		})))));
		if (state.game_count === 0) return null;
		return /* @__PURE__ */ __dil.jsx("card", {
			size: "full",
			padding: 0,
			variant: "soft",
			background: "transparent",
			radius: 0
		}, /* @__PURE__ */ __dil.jsx("box", {
			padding: { x: 0 },
			gap: 0
		}, /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, state.games.map((item, index) => /* @__PURE__ */ __dil.jsx("col", {
			key: item.id,
			gap: 0
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			width: "100%",
			padding: {
				x: 3,
				y: 3
			},
			radius: "md",
			onClick: () => setActiveGameId(item.id)
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "stretch",
			width: "100%",
			gap: 1
		}, /* @__PURE__ */ __dil.jsx(SoccerListTeam, {
			item,
			side: "home",
			wide,
			useFlags: state.use_flag_icons
		}), /* @__PURE__ */ __dil.jsx(SoccerStatus, {
			item,
			compact: true
		}), /* @__PURE__ */ __dil.jsx(SoccerListTeam, {
			item,
			side: "away",
			wide,
			useFlags: state.use_flag_icons
		}))), index !== state.games.length - 1 && /* @__PURE__ */ __dil.jsx("divider", { spacing: -2 }))))));
	}

//#endregion
return SoccerGames;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=soccer-games-eb9d66e6723d.js.map