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
//#region FlightSearchForm.dil.tsx
	function FlightSearchForm(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("FlightSearchForm", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 150
		});
		return /* @__PURE__ */ __dil.jsx(Resolved, { state });
	}
	function Resolved({ state }) {
		const wide = DIL.useBreakpoint("md");
		const [edits, setEdits] = DIL.useState({});
		const [attempted, setAttempted] = DIL.useState(false);
		const capabilities = DIL.useAppData((data) => data.opGenui);
		const enabled = capabilities?.isShared !== true && capabilities?.supportedClientActions?.includes("issue_new_turn") === true;
		const draft = {
			...state.draft,
			...edits
		};
		const labels = state.labels;
		const trip = draft.trip_type ?? (draft.return_date ? "round_trip" : "");
		const now = DIL.useNow(false);
		const today = new Date(now).toISOString().slice(0, 10);
		const error = validationError(draft, trip, today, labels);
		const change = (patch) => setEdits((previous) => ({
			...previous,
			...patch
		}));
		const submit = () => {
			setAttempted(true);
			if (!enabled || validationError(draft, trip, today, labels)) return;
			GenUI.issueNewTurn(labels.search_request + "\\n" + JSON.stringify({
				origin: draft.origin?.trim(),
				destination: draft.destination?.trim(),
				trip_type: trip,
				departure_date: draft.departure_date,
				...trip === "round_trip" ? { return_date: draft.return_date } : {},
				party_size: draft.party_size,
				cabin_class: draft.cabin_class,
				max_connections: draft.max_connections ?? null
			}));
		};
		return /* @__PURE__ */ __dil.jsx("form", {
			onSubmit: submit,
			gap: 3,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("row", {
			gap: 2,
			wrap: "wrap"
		}, /* @__PURE__ */ __dil.jsx("select", {
			ariaLabel: labels.trip_type,
			value: trip,
			placeholder: labels.trip_type,
			disabled: !enabled,
			size: "md",
			pill: true,
			block: false,
			options: [{
				value: "round_trip",
				label: labels.round_trip
			}, {
				value: "one_way",
				label: labels.one_way
			}],
			onChange: (value) => change({
				trip_type: value,
				...value === "one_way" ? { return_date: "" } : {}
			})
		}), /* @__PURE__ */ __dil.jsx("select", {
			ariaLabel: labels.adults,
			value: String(draft.party_size),
			disabled: !enabled,
			size: "md",
			pill: true,
			block: false,
			options: Array.from({ length: 9 }, (_, index) => ({
				value: String(index + 1),
				label: String(index + 1) + " " + (index === 0 ? labels.adult : labels.adults)
			})),
			onChange: (value) => change({ party_size: Number(value) })
		}), /* @__PURE__ */ __dil.jsx("select", {
			ariaLabel: labels.cabin,
			value: draft.cabin_class,
			disabled: !enabled,
			size: "md",
			pill: true,
			block: false,
			options: [
				"economy",
				"premium_economy",
				"business",
				"first"
			].map((value) => ({
				value,
				label: labels[value]
			})),
			onChange: (value) => change({ cabin_class: value })
		})), /* @__PURE__ */ __dil.jsx("box", {
			border: {
				size: .5,
				color: "default"
			},
			background: "surface",
			radius: wide ? "full" : 24,
			padding: 4,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("row", {
			gap: wide ? 4 : 3,
			align: "center",
			wrap: "wrap"
		}, /* @__PURE__ */ __dil.jsx("box", {
			flex: wide ? 1.8 : 1,
			minWidth: wide ? 320 : "100%"
		}, /* @__PURE__ */ __dil.jsx("row", {
			gap: 3,
			align: "center"
		}, /* @__PURE__ */ __dil.jsx("col", {
			flex: 1,
			minWidth: 0,
			gap: 3,
			disableAutoSpacing: true
		}, /* @__PURE__ */ __dil.jsx("row", {
			gap: 3,
			align: "center",
			wrap: wide ? "nowrap" : "wrap"
		}, /* @__PURE__ */ __dil.jsx("box", {
			flex: 1,
			minWidth: wide ? 0 : "100%"
		}, /* @__PURE__ */ __dil.jsx(LocationField, {
			label: labels.origin,
			placeholder: labels.location_hint,
			value: draft.origin ?? "",
			disabled: !enabled,
			name: "origin",
			icon: "plane-horizontal",
			onChange: (value) => change({ origin: value })
		})), wide && /* @__PURE__ */ __dil.jsx(SwapButton, {
			label: labels.swap,
			disabled: !enabled,
			onClick: () => change({
				origin: draft.destination ?? "",
				destination: draft.origin ?? ""
			})
		}), /* @__PURE__ */ __dil.jsx("box", {
			flex: 1,
			minWidth: wide ? 0 : "100%"
		}, /* @__PURE__ */ __dil.jsx(LocationField, {
			label: labels.destination,
			placeholder: labels.location_hint,
			value: draft.destination ?? "",
			disabled: !enabled,
			name: "destination",
			icon: "map-pin",
			onChange: (value) => change({ destination: value })
		})))), !wide && /* @__PURE__ */ __dil.jsx(SwapButton, {
			label: labels.swap,
			disabled: !enabled,
			onClick: () => change({
				origin: draft.destination ?? "",
				destination: draft.origin ?? ""
			})
		}))), /* @__PURE__ */ __dil.jsx("box", {
			flex: 1,
			minWidth: wide ? 288 : "100%"
		}, /* @__PURE__ */ __dil.jsx("row", {
			gap: 3,
			align: "center"
		}, !wide && /* @__PURE__ */ __dil.jsx("icon", {
			name: "calendar",
			size: "lg"
		}), /* @__PURE__ */ __dil.jsx("col", {
			flex: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("row", {
			gap: 2,
			wrap: "wrap"
		}, /* @__PURE__ */ __dil.jsx("box", {
			flex: 1,
			minWidth: 140
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: 1,
			disableAutoSpacing: true
		}, /* @__PURE__ */ __dil.jsx("text", {
			color: "secondary",
			size: "xs"
		}, labels.departure), /* @__PURE__ */ __dil.jsx("date-picker", {
			placeholder: labels.departure,
			value: draft.departure_date ?? "",
			min: today,
			disabled: !enabled,
			block: true,
			size: "md",
			onChange: (value) => change({ departure_date: value })
		}))), trip === "round_trip" && /* @__PURE__ */ __dil.jsx("box", {
			flex: 1,
			minWidth: 140
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: 1,
			disableAutoSpacing: true
		}, /* @__PURE__ */ __dil.jsx("text", {
			color: "secondary",
			size: "xs"
		}, labels.return), /* @__PURE__ */ __dil.jsx("date-picker", {
			placeholder: labels.return,
			value: draft.return_date ?? "",
			min: draft.departure_date && draft.departure_date > today ? draft.departure_date : today,
			disabled: !enabled,
			block: true,
			size: "md",
			onChange: (value) => change({ return_date: value })
		}))))))), /* @__PURE__ */ __dil.jsx("button", {
			submit: true,
			disabled: !enabled,
			block: !wide,
			size: "xl",
			color: "primary"
		}, labels.search))), /* @__PURE__ */ __dil.jsx("row", {
			gap: 2,
			wrap: "wrap"
		}, /* @__PURE__ */ __dil.jsx("select", {
			ariaLabel: labels.connections,
			block: false,
			value: draft.max_connections == null ? "any" : String(draft.max_connections),
			disabled: !enabled,
			size: "sm",
			options: [
				{
					value: "any",
					label: labels.any_stops
				},
				{
					value: "0",
					label: labels.nonstop
				},
				...Array.from({ length: 9 }, (_, index) => ({
					value: String(index + 1),
					label: labels.max_stops + " " + String(index + 1)
				}))
			],
			onChange: (value) => change({ max_connections: value === "any" ? null : Number(value) })
		})), attempted && error && /* @__PURE__ */ __dil.jsx("text", {
			color: "danger",
			size: "sm"
		}, error), !enabled && /* @__PURE__ */ __dil.jsx("text", {
			color: "secondary",
			size: "sm"
		}, labels.unavailable));
	}
	function validationError(draft, trip, today, labels) {
		const origin = draft.origin?.trim() ?? "";
		const destination = draft.destination?.trim() ?? "";
		if (!origin || !destination || origin.length > 120 || destination.length > 120 || origin.toLowerCase() === destination.toLowerCase()) return labels.route_error;
		if (trip !== "one_way" && trip !== "round_trip") return labels.trip_error;
		if (!validDate(draft.departure_date) || draft.departure_date < today || trip === "round_trip" && (!validDate(draft.return_date) || draft.return_date < draft.departure_date)) return labels.date_error;
		if (!Number.isInteger(draft.party_size) || draft.party_size < 1 || draft.party_size > 9 || ![
			"economy",
			"premium_economy",
			"business",
			"first"
		].includes(draft.cabin_class) || draft.max_connections != null && (!Number.isInteger(draft.max_connections) || draft.max_connections < 0 || draft.max_connections > 9)) return labels.options_error;
	}
	function validDate(value) {
		if (!value || !/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return false;
		const parsed = /* @__PURE__ */ new Date(value + "T00:00:00Z");
		return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
	}
	function LocationField({ label, placeholder, value, disabled, name, icon, onChange }) {
		return /* @__PURE__ */ __dil.jsx("label", null, /* @__PURE__ */ __dil.jsx("row", {
			gap: 3,
			align: "center",
			minHeight: 56
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: icon,
			size: "lg"
		}), /* @__PURE__ */ __dil.jsx("col", {
			flex: 1,
			minWidth: 0,
			gap: 0,
			disableAutoSpacing: true
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary"
		}, label), /* @__PURE__ */ __dil.jsx("input", {
			name,
			value,
			placeholder,
			disabled,
			variant: "plain",
			size: "lg",
			onChange
		}))));
	}
	function SwapButton({ label, disabled, onClick }) {
		return /* @__PURE__ */ __dil.jsx("pressable", {
			ariaLabel: label,
			tooltip: label,
			disabled,
			onClick,
			size: 48,
			minSize: 48,
			radius: "full",
			align: "center",
			justify: "center",
			border: {
				size: .5,
				color: "subtle"
			},
			background: "surface"
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: "arrow-up-arrow-down",
			size: "lg"
		}));
	}

//#endregion
return FlightSearchForm;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=flight-search-form-427f73410c26.js.map