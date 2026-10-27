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
//#region StockHeatmap.dil.tsx
	const SvgRect = "rect";
	const SvgText = "text";
	const SvgGroup = "g";
	const SvgDefs = "defs";
	const SvgClip = "clipPath";
	const fontSize = (size) => ({
		"2xs": 10,
		xs: 12,
		sm: 14,
		md: 16,
		lg: 18,
		xl: 20
	})[size] ?? 14;
	function StockHeatmap(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("StockHeatmap", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 460
		});
		return /* @__PURE__ */ __dil.jsx(Heatmap, { state });
	}
	function Heatmap({ state }) {
		const wide = DIL.useBreakpoint("sm");
		const { isDark } = DIL.useTheme();
		const clipPrefix = DIL.useId();
		const [activeId, setActiveId] = DIL.useState(state.active_group_id);
		const group = state.groups.find((item) => item.id === activeId);
		const fill = (value) => typeof value === "string" ? value : value[isDark ? "dark" : "light"];
		const width = wide ? 720 : 320;
		const height = wide ? state.desktop_map_height : state.mobile_map_height;
		const tiles = group ? wide ? group.desktop_tiles : group.mobile_tiles : [];
		return /* @__PURE__ */ __dil.jsx("card", {
			size: "full",
			variant: "soft",
			background: "transparent",
			radius: 0,
			padding: 0
		}, /* @__PURE__ */ __dil.jsx("col", { gap: 4 }, /* @__PURE__ */ __dil.jsx("col", { gap: 1 }, /* @__PURE__ */ __dil.jsx("title", {
			size: "lg",
			weight: "medium"
		}, state.scope_title), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, state.scope_subtitle)), state.groups.length > 1 && /* @__PURE__ */ __dil.jsx("box", null, /* @__PURE__ */ __dil.jsx("segmented-control", {
			options: state.groups.map((item) => ({
				value: item.id,
				label: wide ? item.label : item.short_label
			})),
			value: activeId,
			onChange: setActiveId,
			variant: "ghost",
			size: "md",
			pill: true
		})), group && /* @__PURE__ */ __dil.jsx("col", { gap: 3 }, /* @__PURE__ */ __dil.jsx("box", null, /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			height,
			background: "surface",
			radius: "xl",
			clip: true,
			role: "img",
			ariaLabel: tiles.map((tile) => state.companies[tile.company_index].accessible_label).join("; ")
		}, /* @__PURE__ */ __dil.jsx("svg", {
			width: "100%",
			height,
			viewBox: \`0 0 \${width} \${height}\`,
			preserveAspectRatio: "none"
		}, /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, tiles.map((tile, index) => {
			const company = state.companies[tile.company_index];
			const x = parseFloat(tile.left) * width / 100;
			const y = parseFloat(tile.top) * height / 100;
			const tileWidth = parseFloat(tile.width) * width / 100;
			const tileHeight = parseFloat(tile.height) * height / 100;
			const clipId = \`\${clipPrefix}-\${index}\`;
			const tickerSize = fontSize(tile.ticker_size);
			const changeSize = fontSize(tile.change_size);
			return /* @__PURE__ */ __dil.jsx(SvgGroup, { key: company.ticker }, /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx(SvgDefs, null, /* @__PURE__ */ __dil.jsx(SvgClip, { id: clipId }, /* @__PURE__ */ __dil.jsx(SvgRect, {
				x,
				y,
				width: tileWidth,
				height: tileHeight,
				fill: "white"
			}))), /* @__PURE__ */ __dil.jsx(SvgRect, {
				x,
				y,
				width: tileWidth,
				height: tileHeight,
				fill: fill(company.fill),
				stroke: "white",
				strokeWidth: 1
			}), tile.label_tier === "full" && /* @__PURE__ */ __dil.jsx(SvgGroup, { clipPath: \`url(#\${clipId})\` }, /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx(SvgText, {
				x: x + 5,
				y: y + 3 + tickerSize,
				fill: "white",
				fontSize: tickerSize,
				fontWeight: 400
			}, company.ticker), /* @__PURE__ */ __dil.jsx(SvgText, {
				x: x + 5,
				y: y + 7 + tickerSize + changeSize,
				fill: "white",
				fontSize: changeSize,
				fontWeight: 400
			}, company.change_text)))));
		}))))), /* @__PURE__ */ __dil.jsx("col", { gap: 2 }, /* @__PURE__ */ __dil.jsx("row", {
			justify: "between",
			align: "center",
			gap: 3,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: .5
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary"
		}, "-3%"), /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, state.legend.map((item, index) => /* @__PURE__ */ __dil.jsx("box", {
			key: index,
			width: 9,
			height: 8,
			radius: "xs",
			background: fill(item.fill),
			ariaLabel: item.label
		}))), /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary"
		}, "+3%")), wide && /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "tertiary"
		}, state.as_of_text)), !wide && /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "tertiary"
		}, state.as_of_text)))));
	}

//#endregion
return StockHeatmap;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=stock-heatmap-748c8153bcc6.js.map