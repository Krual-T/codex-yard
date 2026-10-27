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
//#region F1RacesWidgetWithSource.dil.tsx
	function F1RacesWidgetWithSource(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("F1RacesWidgetWithSource", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 520
		});
		return /* @__PURE__ */ __dil.jsx(Races, { state });
	}
	function TrackLink({ race }) {
		return race.track_label ? /* @__PURE__ */ __dil.jsx("pressable", { onClick: () => GenUI.dispatchAction({
			handler: "client",
			type: "open_entity_detail",
			payload: {
				category: "ask_sidebar",
				query: race.track_label,
				extraParams: { context: \`Formula 1 circuit for \${race.label}\` }
			}
		}) }, /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary",
			weight: "bold",
			textAlign: "end",
			underline: "dotted"
		}, race.track_label)) : null;
	}
	function Races({ state }) {
		const [raceId, setRaceId] = DIL.useState(state.active_race_id ?? null);
		const [sessionId, setSessionId] = DIL.useState(state.active_session_id ?? null);
		const [rowsToShow, setRowsToShow] = DIL.useState(state.rows_to_show ?? 5);
		const race = state.races.find((item) => item.id === raceId);
		const session = race?.sessions.find((item) => item.id === sessionId);
		return /* @__PURE__ */ __dil.jsx("card", {
			size: "full",
			padding: 0,
			variant: "soft",
			background: "transparent",
			radius: 0
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: 4,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("col", { gap: 1 }, state.subtitle && /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 1
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			weight: "semibold",
			color: "secondary"
		}, "F1"), /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary"
		}, \`• \${state.subtitle}\`)), /* @__PURE__ */ __dil.jsx("title", { size: "md" }, state.display_title)), state.races.length > 1 && /* @__PURE__ */ __dil.jsx("col", { gap: 4 }, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			scrollable: true,
			gap: 1,
			width: "100%"
		}, state.races.map((option) => /* @__PURE__ */ __dil.jsx("button", {
			key: option.id,
			variant: raceId === option.id ? "soft" : "ghost",
			color: "secondary",
			size: "xs",
			pill: true,
			onClick: () => {
				setRaceId(option.id);
				setSessionId(option.default_session_id ?? null);
				setRowsToShow(5);
			}
		}, option.label))), /* @__PURE__ */ __dil.jsx("box", { padding: { x: 1 } }, /* @__PURE__ */ __dil.jsx("divider", { color: "subtle" }))), race && /* @__PURE__ */ __dil.jsx("col", { gap: 3 }, race.sessions.length > 0 ? /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("row", {
			align: "start",
			gap: 2,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("box", { flex: 1 }, /* @__PURE__ */ __dil.jsx("col", {
			gap: .25,
			align: "start"
		}, race.sessions.length > 1 && /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "prose"
		}, "Track"), /* @__PURE__ */ __dil.jsx("select", {
			name: "selected_session",
			options: race.sessions.map((item) => ({
				label: item.label,
				value: item.id
			})),
			value: sessionId ?? void 0,
			variant: "ghost",
			size: "xs",
			pill: false,
			align: "start",
			onChange: (value) => {
				setSessionId(value);
				setRowsToShow(5);
			}
		})))), /* @__PURE__ */ __dil.jsx("col", {
			gap: .25,
			align: "end"
		}, /* @__PURE__ */ __dil.jsx(TrackLink, { race }), sessionId == null && race.date_label && /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary",
			weight: "bold",
			textAlign: "end"
		}, race.date_label), session?.date_label && /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary",
			weight: "bold",
			textAlign: "end"
		}, session.date_label))), session && session.rows.length > 0 && /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("box", {
			direction: "row",
			scrollable: true
		}, /* @__PURE__ */ __dil.jsx("table", null, [/* @__PURE__ */ __dil.jsx("table-row", null, [
			/* @__PURE__ */ __dil.jsx("table-cell", {
				vAlign: "center",
				colSpan: 2
			}, /* @__PURE__ */ __dil.jsx("text", {
				color: "secondary",
				size: "xs",
				maxLines: 1
			}, state.driver_header)),
			/* @__PURE__ */ __dil.jsx("table-cell", {
				vAlign: "center",
				align: "center"
			}, /* @__PURE__ */ __dil.jsx("text", {
				color: "secondary",
				size: "xs",
				maxLines: 1
			}, state.detail_header)),
			/* @__PURE__ */ __dil.jsx("table-cell", {
				vAlign: "center",
				align: "center"
			}, /* @__PURE__ */ __dil.jsx("text", {
				color: "secondary",
				size: "xs",
				maxLines: 1
			}, session.stat_header))
		]), ...session.rows.slice(0, rowsToShow).map((item) => /* @__PURE__ */ __dil.jsx("table-row", null, [
			/* @__PURE__ */ __dil.jsx("table-cell", {
				vAlign: "center",
				width: "3ch"
			}, /* @__PURE__ */ __dil.jsx("box", {
				flex: 0,
				width: "fit-content",
				padding: { right: .5 }
			}, /* @__PURE__ */ __dil.jsx("text", {
				size: "sm",
				color: "secondary",
				maxLines: 1,
				width: "fit-content"
			}, item.rank))),
			/* @__PURE__ */ __dil.jsx("table-cell", {
				vAlign: "center",
				padding: { x: 0 },
				width: "50%"
			}, /* @__PURE__ */ __dil.jsx("row", {
				align: "center",
				gap: 1,
				padding: { y: 0 }
			}, item.flag_emoji && /* @__PURE__ */ __dil.jsx("box", {
				width: 30,
				align: "center"
			}, /* @__PURE__ */ __dil.jsx("text", {
				size: "lg",
				maxLines: 1
			}, item.flag_emoji)), /* @__PURE__ */ __dil.jsx("col", {
				gap: 0,
				align: "start"
			}, /* @__PURE__ */ __dil.jsx("text", { size: "sm" }, item.name), item.subtitle && /* @__PURE__ */ __dil.jsx("text", {
				color: "tertiary",
				size: "xs",
				maxLines: 1
			}, item.subtitle)))),
			/* @__PURE__ */ __dil.jsx("table-cell", { vAlign: "center" }, /* @__PURE__ */ __dil.jsx("box", { align: "center" }, /* @__PURE__ */ __dil.jsx("box", {
				width: "max-content",
				justify: "center"
			}, /* @__PURE__ */ __dil.jsx("text", {
				size: "xs",
				maxLines: 1
			}, item.detail ?? "-")))),
			/* @__PURE__ */ __dil.jsx("table-cell", { vAlign: "center" }, /* @__PURE__ */ __dil.jsx("box", { align: "center" }, /* @__PURE__ */ __dil.jsx("box", {
				width: "max-content",
				justify: "center"
			}, /* @__PURE__ */ __dil.jsx("text", {
				size: "xs",
				weight: "normal",
				maxLines: 1
			}, item.stat))))
		]))])), session.rows.length > 5 && /* @__PURE__ */ __dil.jsx("box", { padding: { top: 3 } }, /* @__PURE__ */ __dil.jsx("button", {
			variant: "soft",
			block: true,
			onClick: () => setRowsToShow(rowsToShow === 5 ? 999 : 5)
		}, rowsToShow === 5 ? "Show more" : "Show less")))) : /* @__PURE__ */ __dil.jsx("col", {
			gap: 1.5,
			padding: { bottom: 2 }
		}, race.track_label && /* @__PURE__ */ __dil.jsx("row", {
			justify: "between",
			align: "start",
			gap: 3,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary"
		}, "Track"), /* @__PURE__ */ __dil.jsx(TrackLink, { race })), race.status_label && /* @__PURE__ */ __dil.jsx("row", {
			justify: "between",
			align: "start",
			gap: 3,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary"
		}, "Status"), /* @__PURE__ */ __dil.jsx("text", {
			color: race.status_tone || "secondary",
			size: "xs",
			weight: "bold",
			textAlign: "end"
		}, race.status_label)), /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, race.schedule_items.map((item) => /* @__PURE__ */ __dil.jsx("row", {
			key: item.id,
			justify: "between",
			align: "start",
			gap: 3,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary"
		}, item.label), /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary",
			weight: "bold",
			textAlign: "end"
		}, item.time_label))))))));
	}

//#endregion
return F1RacesWidgetWithSource;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=f1-races-widget-4a401924aae7.js.map