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
//#region TaskAutopauseCard.dil.tsx
	function ResolvedAutopause({ state }) {
		const isSm = DIL.useBreakpoint("sm");
		const action = (type) => GenUI.dispatchAction({
			type,
			payload: { task_id: state.task_id }
		});
		return /* @__PURE__ */ __dil.jsx("card", {
			size: "full",
			padding: 0,
			shadow: true
		}, /* @__PURE__ */ __dil.jsx("col", { gap: 0 }, /* @__PURE__ */ __dil.jsx("box", {
			padding: {
				x: 4,
				y: 3
			},
			background: "surface-secondary"
		}, /* @__PURE__ */ __dil.jsx("text", { size: "md" }, state.task_title)), /* @__PURE__ */ __dil.jsx("box", { padding: {
			x: 4,
			y: 4
		} }, /* @__PURE__ */ __dil.jsx("col", {
			gap: isSm ? 4 : 3,
			flex: "auto"
		}, /* @__PURE__ */ __dil.jsx("title", {
			weight: "medium",
			size: "md"
		}, state.prompt), state.show_body && /* @__PURE__ */ __dil.jsx("text", { color: "secondary" }, state.body), /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 2
		}, /* @__PURE__ */ __dil.jsx("button", {
			color: "primary",
			size: "md",
			onClick: () => action("task.resume")
		}, state.continue_label), /* @__PURE__ */ __dil.jsx("button", {
			variant: "outline",
			color: "primary",
			size: "md",
			uniform: true,
			onClick: () => action("task.settings")
		}, /* @__PURE__ */ __dil.jsx("icon", { name: "settings" })), /* @__PURE__ */ __dil.jsx("button", {
			variant: "outline",
			color: "danger",
			size: "md",
			uniform: true,
			onClick: () => action("task.delete")
		}, /* @__PURE__ */ __dil.jsx("icon", { name: "delete" })))))));
	}
	function TaskAutopauseCard(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("TaskAutopauseCard", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 220
		});
		return /* @__PURE__ */ __dil.jsx(ResolvedAutopause, { state });
	}

//#endregion
return TaskAutopauseCard;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=task-autopause-card-32a25d9d0cec.js.map