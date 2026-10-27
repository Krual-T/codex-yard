import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";var t;function n(){return(n=e((()=>{t=`(() => {
var __dilDefaultExport = (function() {


//#region internal/expansion-card-wave2.dil.tsx
	function cardAction(type, state) {
		GenUI.dispatchAction({
			type,
			payload: type === "card.dismiss" ? {
				card_id: state.card_id,
				feed_id: state.feed_id
			} : {
				card_id: state.card_id,
				conversation_id: state.conversation_id,
				feed_id: state.feed_id
			}
		});
	}
	function CardActionButton({ name, type, state }) {
		return /* @__PURE__ */ __dil.jsx("button", {
			variant: "ghost",
			size: "md",
			uniform: true,
			onClick: () => cardAction(type, state)
		}, /* @__PURE__ */ __dil.jsx("icon", { name }));
	}
	function ExpansionActions({ state, showDismiss }) {
		if (!state.show_actions) return null;
		return /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 0
		}, /* @__PURE__ */ __dil.jsx("box", { width: "2px" }), state.show_thumbs_up && /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx(CardActionButton, {
			name: state.reaction === "like" ? "thumb-up-filled" : "thumb-up",
			type: state.reaction === "like" ? "card.reaction.remove" : "card.thumbs_up",
			state
		}), /* @__PURE__ */ __dil.jsx("box", { width: 2 })), state.show_thumbs_down && /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx(CardActionButton, {
			name: state.reaction === "dislike" ? "thumb-down-filled" : "thumb-down",
			type: state.reaction === "dislike" ? "card.reaction.remove" : "card.thumbs_down",
			state
		}), /* @__PURE__ */ __dil.jsx("box", { width: 2 })), state.show_share && /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx(CardActionButton, {
			name: "share",
			type: "card.share",
			state
		}), /* @__PURE__ */ __dil.jsx("box", { width: 2 })), state.show_save && /* @__PURE__ */ __dil.jsx(CardActionButton, {
			name: state.is_saved ? "saved-filled-xs" : "saved-xs",
			type: state.is_saved ? "card.unsave" : "card.save",
			state
		}), showDismiss && state.show_dismiss && /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("box", { width: 2 }), /* @__PURE__ */ __dil.jsx(CardActionButton, {
			name: "x",
			type: "card.dismiss",
			state
		})));
	}
	function ExpansionCardView({ state, task }) {
		const isSm = DIL.useBreakpoint("sm");
		const showImage = task ? task.showImage : true;
		return /* @__PURE__ */ __dil.jsx("card", {
			size: "full",
			padding: task ? 0 : 4,
			shadow: true
		}, /* @__PURE__ */ __dil.jsx("col", { gap: 0 }, task && /* @__PURE__ */ __dil.jsx("box", {
			padding: {
				x: 4,
				y: 3
			},
			background: "surface-secondary"
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 2
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			ariaLabel: state.title,
			flex: 1,
			onClick: () => cardAction("card.open", state)
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 2
		}, /* @__PURE__ */ __dil.jsx("text", { size: "md" }, task.emoji), /* @__PURE__ */ __dil.jsx("text", { size: "md" }, task.title))), state.show_dismiss && /* @__PURE__ */ __dil.jsx("button", {
			variant: "ghost",
			color: "primary",
			size: "md",
			uniform: true,
			onClick: () => cardAction("card.dismiss", state)
		}, /* @__PURE__ */ __dil.jsx("icon", { name: "x" })))), /* @__PURE__ */ __dil.jsx("box", { padding: task ? 4 : 0 }, /* @__PURE__ */ __dil.jsx("box", {
			direction: isSm ? "row" : "col",
			align: isSm ? "center" : "stretch",
			gap: isSm ? 2 : 3
		}, showImage && /* @__PURE__ */ __dil.jsx("pressable", {
			ariaLabel: state.title,
			width: isSm ? 128 : "100%",
			flex: isSm ? "0 0 auto" : void 0,
			onClick: () => cardAction("card.open", state)
		}, /* @__PURE__ */ __dil.jsx("image", {
			src: state.image ?? "",
			alt: "Wildflower meadow with butterflies",
			width: isSm ? 128 : "100%",
			height: isSm ? 128 : "100%",
			aspectRatio: isSm ? 1 : "3/2",
			radius: "xl",
			hideOnFailure: !isSm
		})), /* @__PURE__ */ __dil.jsx("col", {
			gap: 1,
			flex: "auto",
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			ariaLabel: state.title,
			width: "100%",
			onClick: () => cardAction("card.open", state)
		}, /* @__PURE__ */ __dil.jsx("col", { gap: 1 }, /* @__PURE__ */ __dil.jsx("row", { align: "center" }, /* @__PURE__ */ __dil.jsx("box", { width: 4 }), /* @__PURE__ */ __dil.jsx("title", {
			weight: "medium",
			size: "md"
		}, state.title)), /* @__PURE__ */ __dil.jsx("row", { align: "center" }, /* @__PURE__ */ __dil.jsx("box", { width: 4 }), /* @__PURE__ */ __dil.jsx("text", { color: "secondary" }, state.description)))), /* @__PURE__ */ __dil.jsx(ExpansionActions, {
			state,
			showDismiss: !task
		}))))));
	}

//#endregion
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
//#region PulseExpansionCard.dil.tsx
	function PulseExpansionCard(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("PulseExpansionCard", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 240
		});
		return /* @__PURE__ */ __dil.jsx(ExpansionCardView, { state });
	}

//#endregion
return PulseExpansionCard;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=pulse-expansion-card-dc22990eaf03.js.map