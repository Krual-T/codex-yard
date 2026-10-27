import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";var t;function n(){return(n=e((()=>{t=`(() => {
var __dilDefaultExport = (function() {


//#region internal/email-draft-wave2.dil.tsx
	function EmailField({ label, name, value, placeholder, onChange }) {
		return /* @__PURE__ */ __dil.jsx("label", null, /* @__PURE__ */ __dil.jsx("row", { align: "center" }, /* @__PURE__ */ __dil.jsx("box", {
			width: 80,
			minWidth: 80
		}, /* @__PURE__ */ __dil.jsx("text", {
			weight: "semibold",
			color: "tertiary",
			size: "xs"
		}, label)), /* @__PURE__ */ __dil.jsx("box", {
			flex: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("textarea", {
			name,
			value,
			onChange,
			required: true,
			placeholder,
			rows: 1,
			autoResize: true
		}))));
	}
	function EmailDraftView({ state, pulse }) {
		const [localTo, setTo] = DIL.useState(void 0);
		const to = localTo ?? state.defaultTo;
		const [localSubject, setSubject] = DIL.useState(void 0);
		const subject = localSubject ?? state.defaultSubject;
		const [localBody, setBody] = DIL.useState(void 0);
		const body = localBody ?? state.defaultBody;
		const fields = /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("row", { align: "center" }, /* @__PURE__ */ __dil.jsx("box", {
			width: 80,
			minWidth: 80
		}, /* @__PURE__ */ __dil.jsx("text", {
			weight: "semibold",
			color: "tertiary",
			size: "xs"
		}, "FROM")), /* @__PURE__ */ __dil.jsx("text", { color: "tertiary" }, state.emailFrom)), /* @__PURE__ */ __dil.jsx("divider", { flush: true }), /* @__PURE__ */ __dil.jsx(EmailField, {
			label: "TO",
			name: "email.to",
			value: to,
			onChange: setTo,
			placeholder: "name@example.com"
		}), /* @__PURE__ */ __dil.jsx("divider", { flush: true }), /* @__PURE__ */ __dil.jsx(EmailField, {
			label: "SUBJECT",
			name: "email.subject",
			value: subject,
			onChange: setSubject,
			placeholder: "Email subject"
		}), /* @__PURE__ */ __dil.jsx("divider", { flush: true }), /* @__PURE__ */ __dil.jsx("textarea", {
			name: "email.body",
			value: body,
			onChange: setBody,
			required: true,
			placeholder: "Write your message…",
			rows: 9,
			autoResize: true
		}));
		return /* @__PURE__ */ __dil.jsx("card", { size: pulse ? "full" : "lg" }, pulse ? /* @__PURE__ */ __dil.jsx("form", { onSubmit: () => GenUI.dispatchAction({
			type: "email.mailto",
			payload: { email: {
				to,
				subject,
				body
			} }
		}) }, fields, /* @__PURE__ */ __dil.jsx("row", { align: "center" }, /* @__PURE__ */ __dil.jsx("spacer", null), /* @__PURE__ */ __dil.jsx("button", { onClick: () => GenUI.dispatchAction({ type: "email.discard" }) }, "Discard"), /* @__PURE__ */ __dil.jsx("button", { submit: true }, "Send"))) : fields);
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
//#region DraftEmail.dil.tsx
	function DraftEmail(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("DraftEmail", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 360
		});
		return /* @__PURE__ */ __dil.jsx(EmailDraftView, {
			state,
			pulse: false
		});
	}

//#endregion
return DraftEmail;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=draft-email-5fdd1ae9f321.js.map