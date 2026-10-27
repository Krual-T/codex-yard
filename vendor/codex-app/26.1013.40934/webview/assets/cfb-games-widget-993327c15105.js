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
//#region internal/FootballField.dil.tsx
	const SvgRect = "rect";
	const SvgCircle = "circle";
	const SvgPath = "path";
	const SvgText = "text";
	function FootballField({ homeColor, awayColor, possessionTeam, location, previousGain, firstDownDistance }) {
		const wide = DIL.useBreakpoint("sm");
		const { isDark } = DIL.useTheme();
		const width = wide ? 600 : 300;
		const home = homeColor ?? "#e25507";
		const away = awayColor ?? "#00284d";
		const possessionColor = possessionTeam === "away" ? away : home;
		const clamp = (value) => Math.min(100, Math.max(0, value));
		const track = (value) => width * (.035 + clamp(value) * .0093);
		const current = clamp(location.side === "home" ? 100 - location.yardline : location.yardline);
		const direction = possessionTeam === "away" ? 1 : -1;
		const previous = clamp(current - Math.max(0, previousGain ?? 0) * direction);
		const start = Math.min(current, previous);
		const end = Math.max(current, previous);
		const x = track(current);
		return /* @__PURE__ */ __dil.jsx("svg", {
			width: "100%",
			height: 40,
			viewBox: \`0 0 \${width} 40\`,
			preserveAspectRatio: "none",
			color: "secondary"
		}, /* @__PURE__ */ __dil.jsx(SvgRect, {
			x: 0,
			y: 6,
			width,
			height: 8,
			rx: 4,
			fill: isDark ? "#cdcdcd" : "#ededed"
		}), start !== end && /* @__PURE__ */ __dil.jsx(SvgRect, {
			x: track(start),
			y: 6,
			width: track(end) - track(start),
			height: 8,
			rx: 4,
			fill: possessionColor
		}), /* @__PURE__ */ __dil.jsx(SvgRect, {
			x: 0,
			y: 6,
			width: width * .035,
			height: 8,
			rx: 4,
			fill: away
		}), /* @__PURE__ */ __dil.jsx(SvgRect, {
			x: width * .0175,
			y: 6,
			width: width * .0175,
			height: 8,
			fill: away
		}), /* @__PURE__ */ __dil.jsx(SvgRect, {
			x: width * .965,
			y: 6,
			width: width * .035,
			height: 8,
			rx: 4,
			fill: home
		}), /* @__PURE__ */ __dil.jsx(SvgRect, {
			x: width * .965,
			y: 6,
			width: width * .0175,
			height: 8,
			fill: home
		}), /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, [
			10,
			20,
			30,
			40,
			50,
			60,
			70,
			80,
			90
		].map((yardline) => /* @__PURE__ */ __dil.jsx(SvgRect, {
			key: yardline,
			x: track(yardline) - .5,
			y: 7,
			width: 1,
			height: 6,
			rx: .5,
			opacity: .7,
			fill: start !== end && yardline >= start && yardline <= end ? "rgb(227 227 227 / 50%)" : isDark ? "#afafaf" : "#ffffff"
		}))), firstDownDistance != null && /* @__PURE__ */ __dil.jsx(SvgRect, {
			x: track(current + firstDownDistance * direction) - .5,
			y: 6,
			width: 1,
			height: 8,
			fill: isDark ? "#ffd240" : "#ffc300"
		}), /* @__PURE__ */ __dil.jsx(SvgCircle, {
			cx: x,
			cy: 10,
			r: 8,
			fill: possessionColor
		}), /* @__PURE__ */ __dil.jsx(SvgPath, {
			d: FOOTBALL_PATH,
			fill: "#ffffff",
			transform: \`translate(\${x - 5} 5) scale(0.416667)\`
		}), /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, [
			10,
			20,
			30,
			40,
			50,
			60,
			70,
			80,
			90
		].map((yardline) => /* @__PURE__ */ __dil.jsx(SvgText, {
			key: yardline,
			x: track(yardline),
			y: 34,
			fill: "currentColor",
			fontSize: 12,
			fontWeight: 500,
			textAnchor: "middle"
		}, yardline <= 50 ? yardline : 100 - yardline))));
	}
	const FOOTBALL_PATH = "M19.7875 4.22492C20.1709 4.59992 20.4792 5.10825 20.7125 5.74992C20.9459 6.39159 21.0917 7.11659 21.15 7.92492C21.2167 8.73325 21.1917 9.57909 21.075 10.4624L13.5625 2.94992C14.4375 2.82492 15.2792 2.79575 16.0875 2.86242C16.9042 2.92075 17.6292 3.06659 18.2625 3.29992C18.9042 3.53325 19.4125 3.84159 19.7875 4.22492ZM3.48751 11.2499C3.78752 10.3499 4.18335 9.48742 4.67501 8.66242C5.16668 7.83742 5.75002 7.08742 6.42502 6.41242C7.10002 5.72909 7.84585 5.14575 8.66252 4.66242C9.48752 4.17075 10.3542 3.77492 11.2625 3.47492L20.5375 12.7499C20.2458 13.6499 19.8542 14.5124 19.3625 15.3374C18.8708 16.1624 18.2833 16.9124 17.6 17.5874C16.925 18.2708 16.175 18.8583 15.35 19.3499C14.525 19.8416 13.6625 20.2333 12.7625 20.5249L3.48751 11.2499ZM14.1375 12.7124C14.3292 12.9041 14.5625 12.9999 14.8375 12.9999C15.1208 12.9999 15.3583 12.9041 15.55 12.7124C15.7417 12.5208 15.8375 12.2874 15.8375 12.0124C15.8375 11.7291 15.7417 11.4916 15.55 11.2999L12.725 8.47492C12.5333 8.28325 12.2958 8.18742 12.0125 8.18742C11.7375 8.18742 11.5042 8.28325 11.3125 8.47492C11.1208 8.66659 11.025 8.90409 11.025 9.18742C11.025 9.46242 11.1208 9.69575 11.3125 9.88742L14.1375 12.7124ZM11.3125 15.5374C11.5042 15.7291 11.7375 15.8249 12.0125 15.8249C12.2958 15.8249 12.5333 15.7291 12.725 15.5374C12.9167 15.3458 13.0125 15.1124 13.0125 14.8374C13.0125 14.5541 12.9167 14.3166 12.725 14.1249L9.90002 11.2999C9.70002 11.1083 9.45835 11.0124 9.17501 11.0124C8.90002 11.0124 8.66668 11.1083 8.47502 11.2999C8.28335 11.4916 8.18751 11.7291 8.18751 12.0124C8.18751 12.2874 8.28335 12.5208 8.47502 12.7124L11.3125 15.5374ZM4.22502 19.7874C3.84168 19.4124 3.53335 18.9041 3.30001 18.2624C3.06668 17.6208 2.91668 16.8958 2.85001 16.0874C2.79168 15.2791 2.82502 14.4333 2.95002 13.5499L10.4625 21.0624C9.57918 21.1874 8.73335 21.2166 7.92502 21.1499C7.11668 21.0916 6.39168 20.9458 5.75001 20.7124C5.10835 20.4791 4.60002 20.1708 4.22502 19.7874Z";

//#endregion
//#region internal/FootballGames.dil.tsx
	function FootballGames({ componentName, props }) {
		const { resolutionComplete, state } = useResolvedComponentResult(componentName, props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 320
		});
		return /* @__PURE__ */ __dil.jsx(FootballView, { state });
	}
	function FootballStatus({ item, compact = false }) {
		const status = item.game.status;
		const textAlign = compact ? "end" : "center";
		return /* @__PURE__ */ __dil.jsx("col", {
			justify: "center",
			align: compact ? "end" : "center",
			minWidth: compact ? 80 : 82,
			gap: 1
		}, (status === "closed" || status === "complete" || status === "final") && /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("text", {
			textAlign,
			size: "xs",
			weight: "semibold"
		}, item.final_label), /* @__PURE__ */ __dil.jsx("text", {
			textAlign,
			size: "xs",
			color: "secondary"
		}, item.date_string)), (status === "inprogress" || status === "halftime") && /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 1.5
		}, /* @__PURE__ */ __dil.jsx("pulse-indicator", { size: 8 }), /* @__PURE__ */ __dil.jsx("text", {
			textAlign,
			weight: "semibold",
			color: "red-400",
			size: "xs"
		}, item.live_label)), /* @__PURE__ */ __dil.jsx("text", {
			textAlign,
			size: "xs",
			color: compact ? "secondary" : void 0
		}, status === "halftime" ? item.halftime_label : \`\${item.quarter_string} \${item.clock_string}\`)), item.is_scheduled && !item.has_started && /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("text", {
			textAlign,
			size: "xs",
			weight: compact ? "normal" : "semibold",
			color: compact ? void 0 : item.is_today ? "green" : "secondary"
		}, item.date_string), /* @__PURE__ */ __dil.jsx("text", {
			textAlign,
			size: "xs",
			color: compact ? "secondary" : void 0
		}, item.time_string)), item.status_label !== "" && /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("text", {
			textAlign,
			size: "xs",
			weight: "semibold"
		}, item.status_label), /* @__PURE__ */ __dil.jsx("text", {
			textAlign,
			size: "xs",
			color: "secondary"
		}, item.has_started && item.quarter_string !== "" ? item.quarter_string + (item.clock_string !== "" ? \` \${item.clock_string}\` : "") : item.date_string)));
	}
	function FootballTeamName({ team, fallback, compact }) {
		return /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 1
		}, team?.rank != null && /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary"
		}, team.rank), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: compact ? "medium" : void 0,
			textAlign: compact ? void 0 : "center"
		}, team?.name ?? fallback));
	}
	function FootballTeamHeader({ item, side, wide }) {
		const team = item.game[side];
		const record = side === "away" ? item.away_record_label : item.home_record_label;
		const score = /* @__PURE__ */ __dil.jsx("title", {
			size: wide ? "2xl" : "xl",
			weight: "normal"
		}, team?.points ?? "");
		return /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			flex: 1,
			justify: side === "away" ? "start" : "end",
			gap: 4,
			minWidth: 0
		}, wide && side === "home" && item.has_started && score, /* @__PURE__ */ __dil.jsx("col", {
			align: "center",
			gap: .5,
			minWidth: 68
		}, /* @__PURE__ */ __dil.jsx("image", {
			src: team?.logo_url ?? "",
			width: 56,
			height: 56,
			fit: "contain",
			hideOnFailure: true
		}), !wide && item.has_started && score, /* @__PURE__ */ __dil.jsx(FootballTeamName, {
			team,
			fallback: item.tbd_label
		}), record !== "" && /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary"
		}, record)), wide && side === "away" && item.has_started && score);
	}
	function FootballOverview({ item }) {
		return /* @__PURE__ */ __dil.jsx("box", {
			direction: "row",
			scrollable: true
		}, /* @__PURE__ */ __dil.jsx("table", null, /* @__PURE__ */ __dil.jsx("table-row", null, /* @__PURE__ */ __dil.jsx("table-cell", { width: "38%" }, /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary"
		}, item.team_label)), /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, item.scoring_periods.map((period, index) => /* @__PURE__ */ __dil.jsx(SportsTableCell, { key: index }, /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary"
		}, period.label))))), /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, ["away", "home"].map((side) => /* @__PURE__ */ __dil.jsx("table-row", { key: side }, /* @__PURE__ */ __dil.jsx("table-cell", { width: "38%" }, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 1
		}, /* @__PURE__ */ __dil.jsx("image", {
			src: item.game[side]?.logo_url ?? "",
			width: 20,
			height: 20,
			fit: "contain",
			hideOnFailure: true
		}), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium"
		}, item.game[side]?.alias ?? item.tbd_label))), /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, item.scoring_periods.map((period, index) => /* @__PURE__ */ __dil.jsx(SportsTableCell, { key: index }, /* @__PURE__ */ __dil.jsx("text", { size: "sm" }, side === "away" ? period.away_points : period.home_points)))))))));
	}
	function FootballDetail({ item, state, onClose }) {
		const wide = DIL.useBreakpoint("sm");
		const [detailTab, setDetailTab] = DIL.useState(null);
		const [playerSide, setPlayerSide] = DIL.useState("away");
		const tab = detailTab != null && item.detail_tab_values.includes(detailTab) ? detailTab : item.default_detail_tab;
		const possessionTeam = item.possession_team_side == null ? null : item.game[item.possession_team_side];
		return /* @__PURE__ */ __dil.jsx("card", {
			size: "full",
			padding: 0,
			variant: "soft",
			background: "transparent",
			radius: 0
		}, /* @__PURE__ */ __dil.jsx("box", { padding: 0 }, /* @__PURE__ */ __dil.jsx("col", { gap: 1 }, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			justify: "between",
			gap: 2,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: .5,
			flex: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("title", { weight: "semibold" }, item.game_title || item.matchup_title_label)), state.game_count > 1 && /* @__PURE__ */ __dil.jsx("pressable", {
			ariaLabel: state.back_to_games_label,
			onClick: onClose,
			width: 28,
			height: 28,
			align: "center",
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: "x",
			color: "secondary"
		}))), item.venue_text !== "" && /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, item.venue_text)), /* @__PURE__ */ __dil.jsx("box", {
			gap: 0,
			padding: { top: 2 }
		}, /* @__PURE__ */ __dil.jsx("divider", { spacing: 0 })), /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 0,
			padding: { bottom: 3 }
		}, /* @__PURE__ */ __dil.jsx(FootballTeamHeader, {
			item,
			side: "away",
			wide
		}), /* @__PURE__ */ __dil.jsx(FootballStatus, { item }), /* @__PURE__ */ __dil.jsx(FootballTeamHeader, {
			item,
			side: "home",
			wide
		})), item.game.status === "inprogress" && item.possession_text && /* @__PURE__ */ __dil.jsx("col", {
			gap: 2,
			padding: {
				top: 1,
				bottom: 3
			}
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			justify: "center",
			gap: 1.5
		}, possessionTeam && /* @__PURE__ */ __dil.jsx("image", {
			src: possessionTeam.logo_url ?? "",
			width: 18,
			height: 18,
			fit: "contain",
			hideOnFailure: true
		}), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, item.possession_text)), item.field_possession_location != null && item.field_possession_team != null && /* @__PURE__ */ __dil.jsx("row", { padding: { x: wide ? 10 : 1 } }, /* @__PURE__ */ __dil.jsx(FootballField, {
			homeColor: item.game.home?.primary_color,
			awayColor: item.game.away?.primary_color,
			possessionTeam: item.field_possession_team,
			location: item.field_possession_location,
			previousGain: item.field_yards_from_previous_play,
			firstDownDistance: item.field_distance_to_first_down
		}))), item.detail_tabs.length > 1 && /* @__PURE__ */ __dil.jsx("box", { padding: {
			top: 2,
			bottom: 4
		} }, /* @__PURE__ */ __dil.jsx("segmented-control", {
			options: item.detail_tabs,
			value: tab,
			onChange: setDetailTab,
			variant: "ghost",
			size: "md",
			pill: true
		})), item.has_started && tab === "overview" && /* @__PURE__ */ __dil.jsx(FootballOverview, { item }), tab === "team_stats" && /* @__PURE__ */ __dil.jsx(SportsStats, {
			stats: item.team_stats,
			leftSide: "away",
			leftName: item.game.away?.name ?? item.tbd_label,
			rightName: item.game.home?.name ?? item.tbd_label,
			awayColor: item.game.away?.primary_color ?? "#666666",
			homeColor: item.game.home?.primary_color ?? "#999999",
			height: 6,
			secondaryLabel: true
		}), tab === "player_stats" && /* @__PURE__ */ __dil.jsx("col", { gap: 3 }, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 4
		}, /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, ["away", "home"].map((side) => /* @__PURE__ */ __dil.jsx("pressable", {
			key: side,
			padding: .5,
			border: playerSide === side ? { bottom: 1 } : {},
			onClick: () => setPlayerSide(side)
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: playerSide === side ? "bold" : "medium"
		}, item.game[side]?.name ?? item.tbd_label))))), /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, item.team_leaders_by_side[playerSide].filter((category) => category.players.length > 0).map((category) => /* @__PURE__ */ __dil.jsx(PlayerStatsTable, {
			key: category.key,
			category
		})))), tab === "pbp" && /* @__PURE__ */ __dil.jsx("col", {
			height: 300,
			scrollable: true,
			gap: 3
		}, /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, item.pbp_entries.map((play, index) => /* @__PURE__ */ __dil.jsx("col", {
			key: index,
			gap: 1
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			justify: "between",
			gap: 2
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary"
		}, play.display_time), play.score_changed && play.score != null && /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			weight: "semibold"
		}, play.score)), play.down_distance_display != null && /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary"
		}, play.down_distance_display), play.description != null && /* @__PURE__ */ __dil.jsx("text", { size: "sm" }, play.description), index !== item.pbp_entries.length - 1 && /* @__PURE__ */ __dil.jsx("divider", null)))))));
	}
	function FootballView({ state }) {
		const wide = DIL.useBreakpoint("md");
		const [activeGameId, setActiveGameId] = DIL.useState(state.default_active_game_id);
		if (activeGameId != null) {
			const item = state.boxscores.find((game) => game.game.id === activeGameId);
			return item ? /* @__PURE__ */ __dil.jsx(FootballDetail, {
				key: item.game.id,
				item,
				state,
				onClose: () => setActiveGameId(null)
			}) : null;
		}
		if (state.game_count === 0) return null;
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
			gap: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium"
		}, state.league_name), state.season_label && /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, "•"), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, state.season_label))), /* @__PURE__ */ __dil.jsx("title", {
			size: "md",
			weight: "semibold"
		}, state.title)), /* @__PURE__ */ __dil.jsx("col", {
			gap: 3,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, state.boxscores.filter((_, index) => index % 2 === 0).map((_, rowIndex) => /* @__PURE__ */ __dil.jsx("col", {
			key: rowIndex,
			gap: 0
		}, /* @__PURE__ */ __dil.jsx("grid", {
			columns: wide ? 2 : 1,
			gap: wide ? 10 : 4
		}, /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, state.boxscores.slice(rowIndex * 2, rowIndex * 2 + 2).map((item, index) => /* @__PURE__ */ __dil.jsx("grid-item", { key: item.game.id }, /* @__PURE__ */ __dil.jsx("pressable", {
			width: "100%",
			padding: {
				x: 2,
				y: 1
			},
			radius: "md",
			onClick: () => setActiveGameId(item.game.id)
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			justify: "between",
			width: "100%",
			gap: 3
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: 1,
			flex: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, ["away", "home"].map((side) => /* @__PURE__ */ __dil.jsx("row", {
			key: side,
			align: "center",
			gap: 1.5
		}, /* @__PURE__ */ __dil.jsx("image", {
			src: item.game[side]?.logo_url ?? "",
			width: 24,
			height: 24,
			fit: "contain",
			hideOnFailure: true
		}), /* @__PURE__ */ __dil.jsx(FootballTeamName, {
			team: item.game[side],
			fallback: item.tbd_label,
			compact: true
		}), item.has_started && item.game[side]?.points != null && /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, "•"), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "semibold"
		}, item.game[side]?.points)))))), /* @__PURE__ */ __dil.jsx(FootballStatus, {
			item,
			compact: true
		}))), !wide && index === 0 && rowIndex * 2 + 1 < state.game_count && /* @__PURE__ */ __dil.jsx("divider", null))))), rowIndex * 2 + 2 < state.game_count && /* @__PURE__ */ __dil.jsx("divider", { spacing: 2 })))))));
	}

//#endregion
//#region CfbGames.dil.tsx
	function CfbGames(props) {
		return /* @__PURE__ */ __dil.jsx(FootballGames, {
			componentName: "CfbGames",
			props
		});
	}

//#endregion
return CfbGames;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=cfb-games-widget-993327c15105.js.map