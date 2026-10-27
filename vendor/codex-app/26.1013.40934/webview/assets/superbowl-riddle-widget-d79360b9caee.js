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
//#region SuperbowlRiddleWidget.dil.tsx
	function SuperbowlRiddleWidget(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("SuperbowlRiddleWidget", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 320
		});
		return /* @__PURE__ */ __dil.jsx(Riddle, { state });
	}
	function Riddle({ state }) {
		const items = [
			"fox",
			"chicken",
			"grain"
		];
		const [left, setLeft] = DIL.useState(state.left ?? items);
		const [right, setRight] = DIL.useState(state.right ?? []);
		const [boatSide, setBoatSide] = DIL.useState(state.boatSide ?? "left");
		const [inBoat, setInBoat] = DIL.useState(state.inBoat ?? "");
		const [status, setStatus] = DIL.useState(state.status ?? "playing");
		function reset() {
			setLeft(items);
			setRight([]);
			setBoatSide("left");
			setInBoat("");
			setStatus("playing");
		}
		function pick(item, side) {
			const next = (side === "left" ? left : right).filter((value) => value !== item).concat(inBoat ? [inBoat] : []);
			if (side === "left") setLeft(next);
			else setRight(next);
			setInBoat(item);
		}
		function unload() {
			if (boatSide === "left") setLeft(left.concat(inBoat));
			else setRight(right.concat(inBoat));
			setInBoat("");
		}
		function cross() {
			const unattended = boatSide === "left" ? left : right;
			const lost = unattended.includes("chicken") && (unattended.includes("fox") || unattended.includes("grain"));
			const nextRight = boatSide === "left" && inBoat ? right.concat(inBoat) : right;
			if (boatSide === "right" && inBoat) setLeft(left.concat(inBoat));
			setRight(nextRight);
			setStatus(lost ? "lost" : items.every((item) => nextRight.includes(item)) ? "won" : "playing");
			setInBoat("");
			setBoatSide(boatSide === "left" ? "right" : "left");
		}
		const followups = status === "won" ? [
			"What are the riddles I am ready to solve in my life?",
			"How can I keep this momentum after a win?",
			"What did this puzzle teach me about patience and tradeoffs?"
		] : [
			"How do I deal with failure when it stings?",
			"What is one small move that could change this story?",
			"What riddle am I avoiding in my life right now?"
		];
		return /* @__PURE__ */ __dil.jsx("card", {
			size: "lg",
			padding: 12
		}, status === "playing" ? /* @__PURE__ */ __dil.jsx("col", { gap: 2 }, /* @__PURE__ */ __dil.jsx("title", null, "Fox, Chicken, Grain"), /* @__PURE__ */ __dil.jsx("text", null, "Move one item at a time. Never leave fox with chicken, or chicken with grain, without the boat."), /* @__PURE__ */ __dil.jsx("row", {
			justify: "between",
			align: "start",
			gap: 3
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: 1,
			minWidth: 120
		}, /* @__PURE__ */ __dil.jsx("text", null, "Left Bank"), /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, items.filter((item) => left.includes(item)).map((item) => /* @__PURE__ */ __dil.jsx("button", {
			key: item,
			size: "sm",
			disabled: boatSide !== "left",
			onClick: () => pick(item, "left")
		}, item)))), /* @__PURE__ */ __dil.jsx("col", {
			gap: 1,
			minWidth: 240,
			align: "center"
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: 240,
			height: 110,
			padding: 2,
			radius: "lg",
			border: {
				size: 1,
				color: "blue-200"
			},
			background: "blue-50"
		}, /* @__PURE__ */ __dil.jsx("col", {
			height: "100%",
			justify: "between"
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			height: "30%"
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: "50%",
			align: "center",
			justify: "start"
		}, inBoat && boatSide === "left" && /* @__PURE__ */ __dil.jsx("button", {
			size: "xs",
			onClick: unload
		}, inBoat)), /* @__PURE__ */ __dil.jsx("box", {
			width: "50%",
			align: "center",
			justify: "end"
		}, inBoat && boatSide === "right" && /* @__PURE__ */ __dil.jsx("button", {
			size: "xs",
			onClick: unload
		}, inBoat))), /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			height: "70%"
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: "50%",
			align: "center",
			justify: "start"
		}, boatSide === "left" && /* @__PURE__ */ __dil.jsx("box", {
			width: 70,
			height: 26,
			radius: "md",
			background: "orange-300",
			align: "center",
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("text", { size: "xs" }, "boat"))), /* @__PURE__ */ __dil.jsx("box", {
			width: "50%",
			align: "center",
			justify: "end"
		}, boatSide === "right" && /* @__PURE__ */ __dil.jsx("box", {
			width: 70,
			height: 26,
			radius: "md",
			background: "orange-300",
			align: "center",
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("text", { size: "xs" }, "boat")))), /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("button", {
			size: "xs",
			onClick: cross
		}, "<->"))))), /* @__PURE__ */ __dil.jsx("col", {
			gap: 1,
			minWidth: 120
		}, /* @__PURE__ */ __dil.jsx("text", null, "Right Bank"), /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, items.filter((item) => right.includes(item)).map((item) => /* @__PURE__ */ __dil.jsx("button", {
			key: item,
			size: "sm",
			disabled: boatSide !== "right",
			onClick: () => pick(item, "right")
		}, item))))), /* @__PURE__ */ __dil.jsx("row", {
			justify: "between",
			align: "center"
		}, /* @__PURE__ */ __dil.jsx("button", {
			size: "sm",
			color: "secondary",
			onClick: reset
		}, "Reset"))) : /* @__PURE__ */ __dil.jsx("col", {
			gap: 2,
			align: "start"
		}, /* @__PURE__ */ __dil.jsx("title", null, status === "won" ? "Solved!" : "Game Over"), /* @__PURE__ */ __dil.jsx("text", null, status === "won" ? "Everyone made it across. Nice work." : "Uh oh - someone got eaten. Try again when you are ready."), /* @__PURE__ */ __dil.jsx("col", { gap: 1 }, /* @__PURE__ */ __dil.jsx("text", null, status === "won" ? "Follow-up riddles for your life:" : "Follow-up riddles for a reset:"), /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, followups.map((query) => /* @__PURE__ */ __dil.jsx("button", {
			key: query,
			size: "sm",
			color: "secondary",
			onClick: () => GenUI.dispatchAction({
				type: "client",
				payload: {
					action: "issue_new_turn",
					query
				}
			})
		}, query)))), /* @__PURE__ */ __dil.jsx("button", {
			size: "sm",
			color: "secondary",
			onClick: reset
		}, "Reset")));
	}

//#endregion
return SuperbowlRiddleWidget;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=superbowl-riddle-widget-d79360b9caee.js.map