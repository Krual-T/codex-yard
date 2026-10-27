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
//#region MarchMadness.dil.tsx
	function MarchMadness(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("MarchMadness", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 320
		});
		return /* @__PURE__ */ __dil.jsx(Tournament, { state });
	}
	function Tournament({ state }) {
		const wide = DIL.useBreakpoint("md");
		const [roundId, setRoundId] = DIL.useState(state.active_round_id ?? state.default_round_id);
		const [expanded, setExpanded] = DIL.useState(state.expanded ?? false);
		const round = state.rounds.find((item) => item.id === roundId);
		if (!state.rounds.length) return null;
		const rows = expanded ? round?.rows : round?.rows.slice(0, 2);
		return /* @__PURE__ */ __dil.jsx("card", {
			size: "full",
			padding: 0,
			variant: "soft",
			background: "transparent",
			radius: 0
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: 4,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("col", { gap: 3 }, /* @__PURE__ */ __dil.jsx("title", {
			size: "md",
			weight: "semibold"
		}, state.title), state.rounds.length > 1 && /* @__PURE__ */ __dil.jsx("col", { gap: 3 }, /* @__PURE__ */ __dil.jsx("divider", null), /* @__PURE__ */ __dil.jsx("segmented-control", {
			options: state.rounds.map((item) => ({
				value: item.id,
				label: item.label
			})),
			value: roundId,
			variant: "ghost",
			size: "sm",
			pill: true,
			onChange: (value) => {
				setRoundId(value);
				setExpanded(false);
			}
		}))), round && /* @__PURE__ */ __dil.jsx("col", {
			align: "center",
			gap: 6
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: 3,
			width: "100%"
		}, rows?.map((row, rowIndex) => /* @__PURE__ */ __dil.jsx("col", {
			key: row.key ?? rowIndex,
			gap: 0
		}, /* @__PURE__ */ __dil.jsx("grid", {
			columns: wide ? 2 : 1,
			gap: wide ? 10 : 4
		}, row.games.map((entry, index) => /* @__PURE__ */ __dil.jsx("grid-item", { key: entry.key ?? index }, entry.game && /* @__PURE__ */ __dil.jsx(TournamentGame, { game: entry.game }), !wide && index === 0 && row.games[1]?.game != null && /* @__PURE__ */ __dil.jsx("divider", null)))), row.showDivider && rowIndex !== (rows?.length ?? 0) - 1 && /* @__PURE__ */ __dil.jsx("divider", { spacing: 2 })))), round.rows.length > 2 && /* @__PURE__ */ __dil.jsx("button", {
			variant: "outline",
			size: "lg",
			block: true,
			onClick: () => setExpanded(!expanded)
		}, expanded ? state.show_less_label : state.show_more_label))));
	}
	function TournamentGame({ game }) {
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
			gap: 1.5,
			justify: "center",
			height: 26,
			align: "center"
		}, /* @__PURE__ */ __dil.jsx("pulse-indicator", { size: 8 }), /* @__PURE__ */ __dil.jsx("text", {
			weight: "semibold",
			color: "red-400",
			size: "xs"
		}, game.liveLabel)), /* @__PURE__ */ __dil.jsx("row", {
			height: 26,
			align: "center",
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("text", {
			textAlign: "center",
			size: "sm",
			color: "secondary"
		}, game.liveDetail))) : /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("row", {
			height: 26,
			align: "center",
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			textAlign: "center"
		}, game.primaryLabel)), /* @__PURE__ */ __dil.jsx("row", {
			height: 26,
			align: "center",
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary",
			textAlign: "center"
		}, game.secondaryLabel)))));
	}

//#endregion
return MarchMadness;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=march-madness-ac7bc87cd85f.js.map