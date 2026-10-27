import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";var t;function n(){return(n=e((()=>{t=`(() => {
var __dilDefaultExport = (function() {


//#region internal/FollowUpActionBar.dil.tsx
	function FollowUpActionBarPresentation({ actions = [], contentReferenceType, outerPadding = 5 }) {
		return /* @__PURE__ */ __dil.jsx(FollowUpFooter, {
			actions,
			outerPadding,
			onAction: (action) => GenUI.issueNewTurn(action.query, {
				prompt: action.query,
				event_name: "chatgpt_widget_action",
				event_data: {
					widget_affordance: "OPTION",
					widget_action_target: "follow_up",
					widget_action_value: action.label,
					surface_location: "RESPONSE",
					content_reference_type: contentReferenceType,
					is_genui: true
				}
			})
		});
	}
	function FollowUpFooter({ actions, onAction, outerPadding = 5 }) {
		const isSm = DIL.useBreakpoint("sm");
		const isXs = DIL.useBreakpoint("xs");
		const visibleActions = actions.slice(0, isSm ? 3 : isXs ? 2 : 1);
		return actions.length ? /* @__PURE__ */ __dil.jsx("box", { width: "100%" }, /* @__PURE__ */ __dil.jsx("box", { padding: {
			x: outerPadding,
			y: 3
		} }, /* @__PURE__ */ __dil.jsx("divider", null)), /* @__PURE__ */ __dil.jsx("box", { padding: {
			bottom: outerPadding,
			left: outerPadding,
			right: outerPadding
		} }, /* @__PURE__ */ __dil.jsx("box", {
			background: "surface-secondary",
			border: {
				color: "alpha-12",
				size: 1
			},
			padding: {
				x: .5,
				y: .5
			},
			radius: "lg"
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			ariaLabel: "Suggested follow-ups",
			gap: 0,
			role: "group",
			width: "100%"
		}, visibleActions.map((action, index) => /* @__PURE__ */ __dil.jsx("box", {
			align: "center",
			direction: "row",
			flex: 1,
			key: \`\${action.query}:\${index}\`,
			minWidth: 0
		}, index > 0 ? /* @__PURE__ */ __dil.jsx("box", {
			ariaHidden: true,
			background: "alpha-10",
			height: 24,
			width: 1
		}) : null, /* @__PURE__ */ __dil.jsx("box", {
			align: "center",
			flex: 1,
			justify: "center",
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("button", {
			block: true,
			color: "secondary",
			onClick: () => onAction(action),
			size: "sm",
			variant: "ghost"
		}, action.icon ? /* @__PURE__ */ __dil.jsx("icon", { name: action.icon }) : null, " ", action.label)))))))) : null;
	}

//#endregion
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
//#region WeatherWidgetWithSource.dil.tsx
	function logOption(target, value) {
		GenUI.dispatchAction({
			type: "log_event",
			handler: "client",
			payload: {
				event_name: "chatgpt_widget_action",
				event_data: {
					widget_affordance: "OPTION",
					widget_action_target: target,
					widget_action_value: value,
					surface_location: "RESPONSE",
					content_reference_type: "forecast"
				}
			}
		});
	}
	function ResolvedWeather({ state, componentKey }) {
		const liveActivity = useIsLiveActivity();
		const { isDark } = DIL.useTheme();
		const [unit, setUnit] = DIL.useState(state.unit ?? state.initial_unit ?? "F");
		const [focus, setFocus] = DIL.useState(state.focus);
		const [focusDate, setFocusDate] = DIL.useState(state.focus_date);
		const [useCurrent, setUseCurrent] = DIL.useState(state.use_current);
		const [followUps, setFollowUps] = DIL.useState(state.follow_up_actions);
		const forecast = state.forecast;
		const day = forecast.daily.find((item) => item.date_key === focusDate);
		const current = useCurrent ? forecast.current : null;
		const temperature = current?.temperature ?? day?.high;
		if (liveActivity) {
			const focusedDay = day ?? forecast.daily[0];
			const summary = current ?? focusedDay;
			const summaryTemperature = current?.temperature ?? focusedDay?.high;
			return /* @__PURE__ */ __dil.jsx("box", {
				width: "100%",
				padding: 2,
				theme: "dark",
				background: "surface"
			}, summary && summaryTemperature ? /* @__PURE__ */ __dil.jsx("row", {
				align: "center",
				gap: 2,
				width: "100%"
			}, /* @__PURE__ */ __dil.jsx("image", {
				src: summary.icon.dark ?? summary.icon.light,
				width: 32,
				height: 32,
				hideOnFailure: true
			}), /* @__PURE__ */ __dil.jsx("col", {
				gap: 0,
				flex: 1,
				minWidth: 0
			}, /* @__PURE__ */ __dil.jsx("text", {
				size: "sm",
				weight: "medium",
				truncate: true
			}, forecast.location_label), /* @__PURE__ */ __dil.jsx("text", {
				size: "xs",
				color: "secondary",
				truncate: true
			}, summary.description)), /* @__PURE__ */ __dil.jsx("col", {
				gap: 0,
				align: "end"
			}, /* @__PURE__ */ __dil.jsx("title", {
				size: "xl",
				weight: "medium"
			}, unit === "F" ? summaryTemperature.label_f : summaryTemperature.label_c), focusedDay && /* @__PURE__ */ __dil.jsx("text", {
				size: "xs",
				color: "secondary",
				truncate: true
			}, unit === "F" ? \`\${focusedDay.high.label_f} / \${focusedDay.low.label_f}\` : \`\${focusedDay.high.label_c} / \${focusedDay.low.label_c}\`))) : /* @__PURE__ */ __dil.jsx("text", {
				size: "sm",
				weight: "medium",
				truncate: true
			}, forecast.location_label));
		}
		const scrollToValue = focusDate === forecast.hourly_chart_today_key && forecast.hourly_chart_now_start != null ? forecast.hourly_chart_now_start : focusDate != null ? forecast.hourly_chart_day_start[focusDate] : void 0;
		const points = (forecast.hourly_chart ?? []).map((point) => ({
			timestamp: point.timestamp,
			temp_f: point.temp_f,
			temp_c: point.temp_c,
			precip: point.precip_chance,
			_unit: unit,
			formatted: focus === "precip" ? point.precip_chance == null ? "-" : \`\${point.precip_chance}%\` : (unit === "F" ? point.temp_f : point.temp_c) == null ? "-" : \`\${Math.round(unit === "F" ? point.temp_f : point.temp_c)}°\`
		}));
		return /* @__PURE__ */ __dil.jsx("box", {
			role: "region",
			ariaLabel: state.region_label,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			padding: 0
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			width: "100%",
			gap: 2
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 1,
			wrap: "wrap",
			flex: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("box", { role: "heading" }, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium"
		}, forecast.location_label)), state.enable_use_my_location_toggle && /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 1
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "tertiary"
		}, "·"), /* @__PURE__ */ __dil.jsx("pressable", {
			inline: true,
			align: "start",
			width: "fit-content",
			onClick: () => GenUI.dispatchAction({
				handler: "client",
				type: "request_location_permission",
				payload: { issue_new_turn_query_on_success: state.issue_new_turn_query_on_success }
			})
		}, /* @__PURE__ */ __dil.jsx("text", {
			inline: true,
			size: "sm",
			weight: "normal",
			color: "secondary",
			underline: "dotted"
		}, state.use_my_location_label)))), state.share_button_variant === "top_right" && /* @__PURE__ */ __dil.jsx("pressable", {
			ariaLabel: state.share_label,
			tooltip: state.share_label,
			padding: 1.5,
			radius: "full",
			onClick: () => GenUI.dispatchAction({
				type: "share",
				handler: "client",
				payload: { component_key: componentKey }
			})
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: "share",
			color: "secondary",
			size: "sm"
		}))), temperature && /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("spacer", { minSize: 4 }), /* @__PURE__ */ __dil.jsx("row", {
			align: "start",
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("box", { ariaLabel: unit === "F" ? temperature.a11y_label_f : temperature.a11y_label_c }, /* @__PURE__ */ __dil.jsx("title", {
			size: "3xl",
			weight: "medium"
		}, current ? \`\${unit === "F" ? temperature.label_f : temperature.label_c}°\` : \`\${Math.round(unit === "F" ? temperature.fahrenheit : temperature.celsius)}°\`)), /* @__PURE__ */ __dil.jsx("pressable", {
			ariaLabel: unit === "F" ? state.unit_toggle_f_selected_label : state.unit_toggle_c_selected_label,
			padding: {
				x: 2,
				y: .5
			},
			onClick: () => {
				const nextUnit = unit === "F" ? "C" : "F";
				setUnit(nextUnit);
				logOption("unit", nextUnit);
			}
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 1
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "semibold"
		}, unit), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "tertiary"
		}, "/"), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			color: "tertiary"
		}, unit === "F" ? "C" : "F"))))), day && /* @__PURE__ */ __dil.jsx("text", { size: "md" }, day.description), state.show_date_picker && /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("spacer", { minSize: 6 }), /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			flush: true,
			scrollable: true,
			gap: 0
		}, forecast.daily.map((item) => /* @__PURE__ */ __dil.jsx("pressable", {
			key: item.timestamp,
			ariaLabel: unit === "F" ? item.a11y_label_f : item.a11y_label_c,
			padding: {
				x: 2,
				y: 2
			},
			radius: "lg",
			minWidth: 64,
			flex: 1,
			background: item.date_key === focusDate ? \`\${item.accent_color}22\` : "transparent",
			onClick: () => {
				setFocusDate(item.date_key);
				setUseCurrent(item.date_key === forecast.hourly_chart_today_key && forecast.current != null);
				setFollowUps(state.follow_up_actions_by_date[item.date_key] ?? []);
				logOption("focus_date", item.date_key);
			}
		}, /* @__PURE__ */ __dil.jsx("col", {
			align: "center",
			gap: 1
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			truncate: true
		}, item.label), /* @__PURE__ */ __dil.jsx("image", {
			src: item.icon.light,
			alt: \`\${item.label}: \${item.description}\`,
			width: 28,
			height: 28,
			hideOnFailure: true
		}), /* @__PURE__ */ __dil.jsx("text", { weight: "semibold" }, unit === "F" ? item.high.label_f : item.high.label_c), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "tertiary"
		}, unit === "F" ? item.low.label_f : item.low.label_c)))))), /* @__PURE__ */ __dil.jsx("spacer", { minSize: 4 }), /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			flush: true
		}, /* @__PURE__ */ __dil.jsx("box", {
			role: "group",
			ariaLabel: state.focus_mode_label
		}, /* @__PURE__ */ __dil.jsx("select", {
			name: "focus_mode",
			options: [{
				label: state.temperature_label,
				value: "temp"
			}, {
				label: state.precipitation_label,
				value: "precip"
			}],
			value: focus,
			onChange: (value) => {
				if (value === "temp" || value === "precip") {
					setFocus(value);
					logOption("focus_mode", value);
				}
			},
			size: "sm",
			variant: "ghost"
		}))), /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			flush: true,
			padding: { bottom: 2 }
		}, /* @__PURE__ */ __dil.jsx("chart", {
			data: points,
			series: focus === "precip" ? [{
				type: "bar",
				dataKey: "precip",
				color: "blue"
			}] : [{
				type: "area",
				dataKey: "temp_f",
				color: isDark ? "#F5F5F5" : "#111111",
				fillColor: "#F1A03A",
				curveType: "linear"
			}],
			xAxis: {
				dataKey: "timestamp",
				labels: forecast.hourly_chart_labels,
				ticks: forecast.hourly_chart_ticks,
				axisLine: false,
				type: "number"
			},
			yAxis: { domain: focus === "precip" ? [0, 100] : forecast.hourly_chart_domain_all_f ?? void 0 },
			width: "100%",
			height: 120,
			showLegend: false,
			showTooltip: false,
			showGrid: false,
			showYAxis: false,
			showHoverDots: false,
			showDots: true,
			showValueLabels: true,
			barRadius: 0,
			valueLabelInterval: 3,
			valueLabelOffset: 2,
			scrollable: true,
			disableUserScroll: true,
			visiblePointCount: 24,
			barGap: 0,
			barCategoryGap: "0",
			scrollToValue
		})), state.share_button_variant === "bottom" && /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("spacer", { minSize: 3 }), /* @__PURE__ */ __dil.jsx("button", {
			variant: "soft",
			block: true,
			onClick: () => GenUI.dispatchAction({
				type: "share",
				handler: "client",
				payload: { component_key: componentKey }
			})
		}, /* @__PURE__ */ __dil.jsx("icon", { name: "share" }), state.share_label)), /* @__PURE__ */ __dil.jsx(FollowUpActionBarPresentation, {
			actions: followUps,
			contentReferenceType: "forecast",
			outerPadding: 0
		})));
	}
	function WeatherWidgetWithSource(props) {
		const componentKey = DIL.useAppData((appData) => typeof props.__resolutionId === "string" && appData.opGenui?.componentResults?.[props.__resolutionId] != null ? props.__resolutionId : componentDataKey("WeatherWidgetWithSource", props));
		const canShare = DIL.useAppData((appData) => appData.opGenui?.supportedClientActions?.includes("share") === true);
		const { state, resolutionComplete } = useResolvedComponentResult("WeatherWidgetWithSource", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 400
		});
		return /* @__PURE__ */ __dil.jsx(ResolvedWeather, {
			componentKey,
			state: canShare ? state : {
				...state,
				share_button_variant: "none"
			}
		});
	}

//#endregion
return WeatherWidgetWithSource;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=weather-widget-with-source-456940729372.js.map