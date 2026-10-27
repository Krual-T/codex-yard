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
//#region WeatherWidgetV3WithSource.dil.tsx
	function temperatureLabel(temperature, unit) {
		return unit === "F" ? temperature.label_f : temperature.label_c;
	}
	function temperatureAriaLabel(temperature, unit) {
		return unit === "F" ? temperature.a11y_label_f : temperature.a11y_label_c;
	}
	function logWeatherOption(target, value) {
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
	function UnitToggle({ state, unit, onChange }) {
		return /* @__PURE__ */ __dil.jsx("pressable", {
			ariaLabel: unit === "F" ? state.unit_toggle_f_selected_label : state.unit_toggle_c_selected_label,
			padding: {
				x: 2,
				y: .5
			},
			onClick: () => {
				const nextUnit = unit === "F" ? "C" : "F";
				onChange(nextUnit);
				logWeatherOption("unit", nextUnit);
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
		}, unit === "F" ? "C" : "F")));
	}
	function HourlyTable({ state, unit, isWide }) {
		const { isDark } = DIL.useTheme();
		return /* @__PURE__ */ __dil.jsx("table", null, /* @__PURE__ */ __dil.jsx("table-section", { header: true }, /* @__PURE__ */ __dil.jsx("table-row", { header: true }, /* @__PURE__ */ __dil.jsx("table-cell", { vAlign: "center" }, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			color: "secondary"
		}, state.time_label)), /* @__PURE__ */ __dil.jsx("table-cell", {
			vAlign: "center",
			width: isWide ? void 0 : "max-content",
			padding: isWide ? void 0 : { x: 1 }
		}), /* @__PURE__ */ __dil.jsx("table-cell", { vAlign: "center" }, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			color: "secondary"
		}, state.conditions_label)), /* @__PURE__ */ __dil.jsx("table-cell", {
			vAlign: "center",
			width: isWide ? void 0 : "max-content"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			color: "secondary"
		}, state.focus === "precip" ? state.precipitation_label : state.temperature_label)))), /* @__PURE__ */ __dil.jsx("table-section", null, state.forecast.hourly.map((hour) => /* @__PURE__ */ __dil.jsx("table-row", { key: hour.timestamp }, /* @__PURE__ */ __dil.jsx("table-cell", { vAlign: "center" }, /* @__PURE__ */ __dil.jsx("text", { size: "sm" }, hour.label)), /* @__PURE__ */ __dil.jsx("table-cell", {
			vAlign: "center",
			padding: isWide ? void 0 : { x: 1 }
		}, /* @__PURE__ */ __dil.jsx("image", {
			src: isDark ? hour.icon.dark : hour.icon.light,
			alt: \`\${hour.label}: \${hour.description}\`,
			width: 28,
			height: 28,
			hideOnFailure: true
		})), /* @__PURE__ */ __dil.jsx("table-cell", { vAlign: "center" }, /* @__PURE__ */ __dil.jsx("text", { size: "sm" }, hour.description)), /* @__PURE__ */ __dil.jsx("table-cell", { vAlign: "center" }, /* @__PURE__ */ __dil.jsx("text", { size: "sm" }, state.focus === "precip" ? hour.precip_chance == null ? "-" : \`\${hour.precip_chance}%\` : temperatureLabel(hour.temperature, unit)))))));
	}
	function ResolvedWeather({ state }) {
		const liveActivity = useIsLiveActivity();
		const isWide = DIL.useBreakpoint("sm");
		const { isDark } = DIL.useTheme();
		const [unit, setUnit] = DIL.useState(state.unit ?? state.initial_unit ?? "F");
		const [focus, setFocus] = DIL.useState(state.focus);
		const [focusDate, setFocusDate] = DIL.useState(state.focus_date);
		const [useCurrent, setUseCurrent] = DIL.useState(state.use_current);
		const forecast = state.forecast;
		const focusedDay = forecast.daily.find((day) => day.date_key === focusDate);
		const current = useCurrent ? forecast.current : null;
		const headlineTemperature = current?.temperature ?? focusedDay?.high;
		const isChart = state.presentation === "chart";
		if (liveActivity) {
			const day = focusedDay ?? forecast.daily[0];
			const hour = isChart ? null : forecast.hourly[0];
			const summary = current ?? hour ?? day;
			const temperature = current?.temperature ?? hour?.temperature ?? day?.high;
			return /* @__PURE__ */ __dil.jsx("box", {
				width: "100%",
				padding: 2,
				theme: "dark",
				background: "surface"
			}, summary && temperature ? /* @__PURE__ */ __dil.jsx("row", {
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
			}, temperatureLabel(temperature, unit)), day && /* @__PURE__ */ __dil.jsx("text", {
				size: "xs",
				color: "secondary",
				truncate: true
			}, \`\${temperatureLabel(day.high, unit)} / \${temperatureLabel(day.low, unit)}\`))) : /* @__PURE__ */ __dil.jsx("text", {
				size: "sm",
				weight: "medium",
				truncate: true
			}, forecast.location_label));
		}
		const scrollToValue = focusDate === forecast.hourly_chart_today_key && forecast.hourly_chart_now_start != null ? forecast.hourly_chart_now_start : focusDate != null ? forecast.hourly_chart_day_start[focusDate] : void 0;
		const chartData = forecast.hourly_chart.map((point) => {
			const temperature = unit === "F" ? point.temp_f : point.temp_c;
			return {
				timestamp: point.timestamp,
				temp_f: point.temp_f,
				precip: point.precip_chance,
				formatted: focus === "precip" ? point.precip_chance == null ? "-" : \`\${point.precip_chance}%\` : temperature == null ? "-" : \`\${Math.round(temperature)}°\`
			};
		});
		return /* @__PURE__ */ __dil.jsx("box", {
			role: "region",
			ariaLabel: state.region_label,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			padding: 0
		}, /* @__PURE__ */ __dil.jsx("col", { gap: isChart ? 0 : 4 }, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 2
		}, /* @__PURE__ */ __dil.jsx("box", {
			flex: 1,
			minWidth: 0,
			role: "heading"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium"
		}, forecast.location_label)), state.share_button_variant === "top_right" && /* @__PURE__ */ __dil.jsx("pressable", {
			ariaLabel: state.share_label,
			tooltip: state.share_label,
			padding: 1.5,
			radius: "full",
			onClick: () => GenUI.dispatchAction({
				type: "share",
				handler: "client"
			})
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: "share",
			color: "secondary",
			size: "sm"
		}))), isChart ? /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, headlineTemperature && /* @__PURE__ */ __dil.jsx("col", {
			gap: 3,
			padding: { top: 5 }
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "start",
			gap: 0
		}, /* @__PURE__ */ __dil.jsx("box", { ariaLabel: temperatureAriaLabel(headlineTemperature, unit) }, /* @__PURE__ */ __dil.jsx("title", {
			size: "3xl",
			weight: "medium"
		}, temperatureLabel(headlineTemperature, unit), current ? "°" : "")), /* @__PURE__ */ __dil.jsx(UnitToggle, {
			state,
			unit,
			onChange: setUnit
		})), focusedDay && /* @__PURE__ */ __dil.jsx("text", null, focusedDay.description)), state.show_date_picker && /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			scrollable: true,
			gap: 0,
			padding: { top: 5.5 }
		}, forecast.daily.map((day) => /* @__PURE__ */ __dil.jsx("pressable", {
			key: day.timestamp,
			ariaLabel: unit === "F" ? day.a11y_label_f : day.a11y_label_c,
			ariaPressed: day.date_key === focusDate,
			padding: {
				x: 2,
				y: 2
			},
			radius: "lg",
			minWidth: 64,
			flex: 1,
			background: day.date_key === focusDate ? \`\${day.accent_color}22\` : "transparent",
			onClick: () => {
				setFocusDate(day.date_key);
				setUseCurrent(day.date_key === forecast.hourly_chart_today_key && forecast.current != null);
				logWeatherOption("focus_date", day.date_key);
			}
		}, /* @__PURE__ */ __dil.jsx("col", {
			align: "center",
			gap: 1
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			truncate: true
		}, day.label), /* @__PURE__ */ __dil.jsx("image", {
			src: isDark ? day.icon.dark : day.icon.light,
			alt: \`\${day.label}: \${day.description}\`,
			width: 28,
			height: 28,
			hideOnFailure: true
		}), /* @__PURE__ */ __dil.jsx("text", { weight: "semibold" }, temperatureLabel(day.high, unit)), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "tertiary"
		}, temperatureLabel(day.low, unit)))))), /* @__PURE__ */ __dil.jsx("box", {
			role: "group",
			ariaLabel: state.focus_mode_label,
			padding: { top: 5 }
		}, /* @__PURE__ */ __dil.jsx("select", {
			ariaLabel: state.focus_mode_label,
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
					logWeatherOption("focus_mode", value);
				}
			},
			size: "sm",
			variant: "ghost"
		})), /* @__PURE__ */ __dil.jsx("box", { padding: {
			top: 2,
			bottom: 2
		} }, /* @__PURE__ */ __dil.jsx("chart", {
			data: chartData,
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
		}))) : /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			justify: "between",
			gap: 2
		}, /* @__PURE__ */ __dil.jsx("title", {
			size: "md",
			weight: "semibold"
		}, state.hourly_table_date_label), state.focus === "temp" && /* @__PURE__ */ __dil.jsx(UnitToggle, {
			state,
			unit,
			onChange: setUnit
		})), /* @__PURE__ */ __dil.jsx(HourlyTable, {
			state,
			unit,
			isWide
		})), state.share_button_variant === "bottom" && /* @__PURE__ */ __dil.jsx("box", { padding: isChart ? { top: 5.75 } : void 0 }, /* @__PURE__ */ __dil.jsx("button", {
			variant: "soft",
			block: true,
			onClick: () => GenUI.dispatchAction({
				type: "share",
				handler: "client"
			})
		}, /* @__PURE__ */ __dil.jsx("icon", { name: "share" }), state.share_label)))));
	}
	function WeatherWidgetV3WithSource(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("WeatherWidgetV3WithSource", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 400
		});
		return /* @__PURE__ */ __dil.jsx(ResolvedWeather, { state });
	}

//#endregion
return WeatherWidgetV3WithSource;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=weather-widget-v3-with-source-1710388c5c41.js.map