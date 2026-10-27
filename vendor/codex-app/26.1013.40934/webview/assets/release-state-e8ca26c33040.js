import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";import{CPt as t,Cot as n,ILt as r,Rxt as i,SLt as a,Sot as o,XIt as s,Xxt as c,hzt as l,jxt as u,lSt as d,uLt as f,vLt as p,xLt as m}from"./app-shared-61271c39e3c5.js";import{$Mr as h,Hwr as g,Kjr as _,QMr as v,jwr as y,qjr as b}from"./app-initial-a68277f60b93.js";var x,S;function C(){return(C=e((()=>{x={CoTToolGroup:`(() => {
var __dilDefaultExport = (function() {


//#region src/messages.dil.ts
	const fallbackMessages = { moreItems: "+{count} more" };
	function useMessages() {
		const messages = DIL.useAppData((data) => data.messages);
		return {
			...fallbackMessages,
			...messages
		};
	}
	function formatMessage(template, values = {}) {
		return template.replace(/\\{(\\w+)\\}/g, (placeholder, key) => values[key] === void 0 ? placeholder : String(values[key]));
	}

//#endregion
//#region src/SourceCards.dil.tsx
	const OVERFLOW_THRESHOLD = 8;
	const INITIAL_VISIBLE_COUNT = 6;
	function SourceCards({ children, label }) {
		const [expanded, setExpanded] = DIL.useState(false);
		const messages = useMessages();
		const visibleCount = expanded || children.length <= OVERFLOW_THRESHOLD ? children.length : INITIAL_VISIBLE_COUNT;
		return /* @__PURE__ */ __dil.jsx("carousel", {
			ariaLabel: label,
			gap: 2,
			flush: true,
			snap: "none"
		}, [...children.slice(0, visibleCount), visibleCount < children.length && /* @__PURE__ */ __dil.jsx("carousel-item", { key: "overflow" }, /* @__PURE__ */ __dil.jsx("pressable", {
			onClick: () => setExpanded(true),
			height: "100%",
			justify: "center",
			align: "start"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary"
		}, formatMessage(messages.moreItems, { count: children.length - visibleCount }))))]);
	}

//#endregion
//#region src/CalendarSources.dil.tsx
	function CalendarSources({ sources, label }) {
		return /* @__PURE__ */ __dil.jsx(SourceCards, { label }, sources.map((source, index) => /* @__PURE__ */ __dil.jsx("carousel-item", {
			key: \`\${source.url ?? source.title}-\${index}\`,
			maxWidth: 200
		}, source.url ? /* @__PURE__ */ __dil.jsx("link", {
			href: source.url,
			title: source.title
		}, /* @__PURE__ */ __dil.jsx(CalendarCard, { source })) : /* @__PURE__ */ __dil.jsx(CalendarCard, { source }))));
	}
	function CalendarCard({ source }) {
		const [hovered, setHovered] = DIL.useState(false);
		return /* @__PURE__ */ __dil.jsx("box", {
			radius: "lg",
			clip: true
		}, /* @__PURE__ */ __dil.jsx("badge", {
			color: hovered ? "var(--color-background-secondary-soft-alpha-hover)" : "secondary",
			variant: "soft",
			pill: false,
			padding: 0,
			onHover: source.url ? setHovered : void 0
		}, /* @__PURE__ */ __dil.jsx("row", {
			gap: 2,
			align: "stretch",
			padding: {
				top: 2,
				right: 2,
				bottom: 2,
				left: 1.5
			},
			maxWidth: 200
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: 4,
			flex: "none",
			radius: "full",
			background: source.color ?? "info-solid",
			ariaHidden: true
		}), /* @__PURE__ */ __dil.jsx("col", {
			gap: .5,
			padding: { bottom: .5 },
			minWidth: 0,
			flex: 1
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary",
			weight: "medium",
			truncate: true
		}, source.title), /* @__PURE__ */ __dil.jsx("text", {
			size: "2xs",
			color: "tertiary",
			truncate: true
		}, source.date && source.time ? \`\${source.date} • \${source.time}\` : source.date || source.time)))));
	}

//#endregion
//#region src/EmailSources.dil.tsx
	function EmailSources({ sources, label }) {
		return /* @__PURE__ */ __dil.jsx(SourceCards, { label }, sources.map((source, index) => /* @__PURE__ */ __dil.jsx("carousel-item", {
			key: \`\${source.url ?? source.subject}-\${index}\`,
			maxWidth: 200
		}, source.url ? /* @__PURE__ */ __dil.jsx("link", {
			href: source.url,
			title: source.subject
		}, /* @__PURE__ */ __dil.jsx(EmailCard, { source })) : /* @__PURE__ */ __dil.jsx(EmailCard, { source }))));
	}
	function EmailCard({ source }) {
		const [hovered, setHovered] = DIL.useState(false);
		return /* @__PURE__ */ __dil.jsx("box", {
			radius: "lg",
			clip: true
		}, /* @__PURE__ */ __dil.jsx("badge", {
			color: hovered ? "var(--color-background-secondary-soft-alpha-hover)" : "secondary",
			variant: "soft",
			pill: false,
			padding: 0,
			onHover: source.url ? setHovered : void 0
		}, /* @__PURE__ */ __dil.jsx("row", {
			gap: 2,
			align: "start",
			padding: 2,
			maxWidth: 200
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: 20,
			height: 20,
			flex: "none",
			ariaHidden: true
		}, source.senderIcon ? /* @__PURE__ */ __dil.jsx("image", {
			src: source.senderIcon,
			alt: "",
			width: 20,
			height: 20,
			radius: "full",
			fit: "cover",
			fallback: /* @__PURE__ */ __dil.jsx(SenderInitial, { sender: source.sender })
		}) : /* @__PURE__ */ __dil.jsx(SenderInitial, { sender: source.sender })), /* @__PURE__ */ __dil.jsx("col", {
			gap: 0,
			minWidth: 0,
			flex: 1
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary",
			weight: "medium",
			truncate: true
		}, source.subject), /* @__PURE__ */ __dil.jsx("text", {
			size: "2xs",
			color: "tertiary",
			truncate: true
		}, source.date ? \`\${source.date} • \${source.sender}\` : source.sender)))));
	}
	function SenderInitial({ sender }) {
		return /* @__PURE__ */ __dil.jsx("box", {
			width: 20,
			height: 20,
			radius: "full",
			background: "discovery-solid",
			align: "center",
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "2xs",
			color: "white",
			weight: "medium"
		}, sender.slice(0, 1).toUpperCase()));
	}

//#endregion
//#region src/WebSearch.dil.tsx
	const FAVICON_PRELOAD_LIMIT = 20;
	function useCountingValue(target, isActive, intervalMs) {
		const [value, setValue] = DIL.useState(isActive ? 1 : target);
		const [isSettled, setIsSettled] = DIL.useState(!isActive);
		const now = DIL.useNow(isActive && (value < target || !isSettled), intervalMs);
		const [lastStepAt, setLastStepAt] = DIL.useState(now);
		DIL.useEffect(() => {
			if (!isActive) return;
			if (value < target && isSettled) {
				setIsSettled(false);
				setLastStepAt(now);
			} else if (now - lastStepAt >= intervalMs) if (value < target) {
				setValue(value + 1);
				setLastStepAt(Math.max(lastStepAt + intervalMs, now - intervalMs));
			} else setIsSettled(true);
		}, [
			now,
			lastStepAt,
			intervalMs,
			target,
			isActive,
			value,
			isSettled
		]);
		return {
			value: Math.min(value, target),
			isSettled: isSettled && value >= target
		};
	}
	function useSearchFaviconUrl(urls, isActive) {
		const { value } = useCountingValue(urls?.length ?? 0, isActive, 300);
		return urls?.[value - 1];
	}
	function SearchFavicon({ url, urls }) {
		const nextIndex = url == null ? 0 : urls.indexOf(url) + 1;
		const upcomingUrls = urls.slice(nextIndex, nextIndex + FAVICON_PRELOAD_LIMIT);
		return /* @__PURE__ */ __dil.jsx("box", {
			size: 20,
			align: "center",
			justify: "center",
			gap: 0,
			flex: "0 0 auto",
			ariaHidden: true
		}, /* @__PURE__ */ __dil.jsx("box", {
			size: 0,
			clip: true,
			gap: 0,
			flex: "0 0 auto",
			ariaHidden: true
		}, upcomingUrls.map((upcomingUrl) => /* @__PURE__ */ __dil.jsx("favicon", {
			key: upcomingUrl,
			url: upcomingUrl,
			size: 16
		}))), url != null && /* @__PURE__ */ __dil.jsx("box", {
			size: 16,
			radius: "full",
			border: {
				size: .5,
				color: "default"
			},
			clip: true
		}, /* @__PURE__ */ __dil.jsx("favicon", {
			key: url,
			url,
			size: "100%"
		})));
	}
	function SearchTitle({ title, count, animateCount, shimmer, color }) {
		const { value: displayedCount, isSettled } = useCountingValue(count, animateCount, 60);
		const match = title.match(/^(\\D*)(\\d+)(\\D*)$/);
		if (!animateCount || count < 2 || isSettled || match == null || Number(match[2]) !== count) {
			const Text = shimmer ? "shimmer-text" : "text";
			return /* @__PURE__ */ __dil.jsx(Text, {
				size: "md",
				color,
				weight: "normal",
				tabularNums: true,
				truncate: true
			}, title);
		}
		const prefix = match[1];
		const suffix = match[3];
		const digits = String(displayedCount).split("");
		return /* @__PURE__ */ __dil.jsx("row", {
			gap: 0,
			align: "stretch",
			ariaLabel: \`\${prefix}\${displayedCount}\${suffix}\`
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			color,
			weight: "normal",
			preserveWhitespace: true
		}, prefix), /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, digits.map((digit, index) => /* @__PURE__ */ __dil.jsx("box", {
			key: digits.length - index,
			clip: true
		}, /* @__PURE__ */ __dil.jsx("transition", {
			dimension: "width",
			initial: {
				opacity: 0,
				translateY: -12
			},
			enter: {
				opacity: 1,
				translateY: 0,
				duration: 40,
				delay: 0,
				timingFunction: "ease-out"
			},
			exit: {
				opacity: 0,
				translateY: 12,
				duration: 40,
				delay: 0,
				timingFunction: "ease-out"
			},
			preventInitialTransition: true
		}, /* @__PURE__ */ __dil.jsx("text", {
			key: digit,
			size: "md",
			color,
			weight: "normal",
			tabularNums: true
		}, digit))))), /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			color,
			weight: "normal",
			preserveWhitespace: true,
			truncate: true
		}, suffix));
	}
	function WebSearchDetails({ item }) {
		const [allQueries, setAllQueries] = DIL.useState(false);
		const [allResources, setAllResources] = DIL.useState(false);
		const queries = item.queries ?? [];
		const resources = item.resources?.filter((resource) => resource.type === "web_search_source") ?? [];
		const queryOverflow = queries.length > 3 && item.moreQueriesLabel != null;
		const resourceOverflow = resources.length > 8 && item.moreResourcesLabel != null;
		return /* @__PURE__ */ __dil.jsx("row", {
			gap: 2,
			wrap: "wrap",
			align: "center",
			width: "100%"
		}, resources.length > 0 ? /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, (resourceOverflow && !allResources ? resources.slice(0, 7) : resources).map((source) => /* @__PURE__ */ __dil.jsx("link", {
			key: source.url,
			href: source.url,
			title: source.title
		}, /* @__PURE__ */ __dil.jsx(SearchPill, {
			key: \`source-pill-\${item.id}-\${source.url}\`,
			label: source.attribution,
			resources: [source],
			interactive: true
		}))), resourceOverflow && /* @__PURE__ */ __dil.jsx("pressable", {
			key: "resource-overflow",
			onClick: () => setAllResources(!allResources),
			ariaPressed: allResources
		}, /* @__PURE__ */ __dil.jsx(SearchPill, {
			label: allResources ? item.showLessLabel : item.moreResourcesLabel,
			resources: allResources ? void 0 : resources.slice(7, 10)
		}))) : /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, (queryOverflow && !allQueries ? queries.slice(0, 2) : queries).map((query) => /* @__PURE__ */ __dil.jsx(SearchPill, {
			key: \`query-pill-\${item.id}-\${query}\`,
			label: query,
			query: true
		})), queryOverflow && /* @__PURE__ */ __dil.jsx("pressable", {
			key: "query-overflow",
			onClick: () => setAllQueries(!allQueries),
			ariaPressed: allQueries
		}, /* @__PURE__ */ __dil.jsx(SearchPill, { label: allQueries ? item.showLessLabel : item.moreQueriesLabel }))), item.pattern != null && /* @__PURE__ */ __dil.jsx(SearchPill, {
			label: item.pattern,
			query: true
		}));
	}
	function SearchPill({ label, resources, query = false, interactive = false }) {
		const [hovered, setHovered] = DIL.useState(false);
		return /* @__PURE__ */ __dil.jsx("badge", {
			size: "lg",
			padding: {
				left: query || resources?.length ? 2 : 3,
				right: 3
			},
			maxWidth: "100%",
			weight: "normal",
			color: hovered ? "var(--color-background-secondary-soft-alpha-hover)" : "secondary",
			variant: "soft",
			onHover: interactive ? setHovered : void 0
		}, /* @__PURE__ */ __dil.jsx("row", {
			gap: 1,
			align: "center",
			minWidth: 0
		}, query && /* @__PURE__ */ __dil.jsx("icon", {
			name: "search",
			size: "xs",
			color: "secondary"
		}), resources != null && /* @__PURE__ */ __dil.jsx("row", {
			gap: 0,
			flex: "none",
			ariaHidden: true
		}, resources.map((source, index) => /* @__PURE__ */ __dil.jsx("box", {
			key: source.url,
			width: index === resources.length - 1 ? 12 : 8,
			flex: "none"
		}, /* @__PURE__ */ __dil.jsx("favicon", {
			url: source.url,
			size: 12,
			frame: resources.length > 1
		})))), /* @__PURE__ */ __dil.jsx("box", {
			minWidth: 0,
			maxWidth: query ? "8rem" : void 0
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary",
			truncate: true
		}, label))));
	}

//#endregion
//#region src/CoTToolGroup.dil.tsx
	const nativeIconNames = {
		api_tool: "apps",
		"book-open": "reading-level",
		"code-searching": "search",
		"edit-files": "pencil",
		finances: "chart-no-axes-combined",
		globe: "globe",
		library: "books",
		"list-files": "folders",
		"run-command": "terminal"
	};
	function ToolIcon({ icon, expanded, faviconUrl }) {
		if (icon.type === "favicons") return /* @__PURE__ */ __dil.jsx(SearchFavicon, {
			url: faviconUrl,
			urls: icon.urls
		});
		return /* @__PURE__ */ __dil.jsx("box", {
			width: 20,
			height: 20,
			align: "center",
			justify: "center",
			flex: "0 0 auto",
			ariaHidden: true
		}, icon.type === "native" ? /* @__PURE__ */ __dil.jsx("icon", {
			name: nativeIconNames[icon.name],
			weight: "light",
			size: icon.name === "finances" ? "lg" : "md",
			color: expanded && icon.name !== "globe" ? "primary" : "secondary"
		}) : /* @__PURE__ */ __dil.jsx("image", {
			src: icon.src,
			alt: "",
			width: 20,
			height: 20,
			fit: "contain",
			radius: icon.kind === "favicon" ? "full" : void 0,
			frame: icon.kind === "favicon",
			fallback: /* @__PURE__ */ __dil.jsx("icon", {
				name: icon.kind === "favicon" ? "globe" : "apps",
				weight: "light",
				size: "md",
				color: "secondary"
			})
		}));
	}
	function ActivityLabel({ title, isActive, icon, expanded, onToggle, numResources, animateCount = true }) {
		const [hovered, setHovered] = DIL.useState(false);
		const faviconUrl = useSearchFaviconUrl(icon?.type === "favicons" ? icon.urls : void 0, isActive);
		const Container = onToggle != null ? "pressable" : "box";
		const color = onToggle != null && hovered ? "primary" : "tertiary";
		return /* @__PURE__ */ __dil.jsx(Container, {
			direction: "row",
			align: "center",
			gap: 2,
			maxWidth: "100%",
			ariaLabel: onToggle != null ? title : void 0,
			onClick: onToggle,
			onHover: onToggle != null ? setHovered : void 0
		}, icon != null && /* @__PURE__ */ __dil.jsx(ToolIcon, {
			icon,
			expanded,
			faviconUrl
		}), /* @__PURE__ */ __dil.jsx("row", {
			gap: 1,
			align: "center",
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("box", {
			minWidth: 0,
			ariaHidden: onToggle != null
		}, /* @__PURE__ */ __dil.jsx(ActivityText, {
			title,
			numResources,
			animateCount: isActive && animateCount,
			shimmer: isActive && (onToggle == null || !hovered),
			color
		})), onToggle != null && /* @__PURE__ */ __dil.jsx("box", {
			width: 16,
			height: 16,
			ariaHidden: true
		}, /* @__PURE__ */ __dil.jsx("transition", {
			initial: {
				rotate: expanded ? -90 : 90,
				opacity: 1
			},
			enter: {
				rotate: 0,
				opacity: 1,
				duration: 150,
				delay: 0
			},
			exit: {
				opacity: 0,
				duration: 0,
				delay: 0
			},
			layoutEnter: {
				duration: 0,
				delay: 0
			},
			layoutExit: {
				duration: 0,
				delay: 0
			},
			layoutMove: {
				duration: 0,
				delay: 0
			},
			preventInitialTransition: true
		}, /* @__PURE__ */ __dil.jsx("box", {
			key: expanded ? "expanded" : "collapsed",
			width: 16,
			height: 16,
			align: "center",
			justify: "center"
		}, (expanded || hovered) && /* @__PURE__ */ __dil.jsx("icon", {
			name: expanded ? "chevron-down" : "chevron-right",
			size: "sm",
			color
		}))))));
	}
	function ActivityText({ title, numResources, animateCount, shimmer, color }) {
		if (numResources != null) return /* @__PURE__ */ __dil.jsx(SearchTitle, {
			title,
			count: numResources,
			animateCount,
			shimmer,
			color
		});
		const Text = shimmer ? "shimmer-text" : "text";
		return /* @__PURE__ */ __dil.jsx(Text, {
			size: "md",
			color,
			weight: "normal",
			truncate: true
		}, title);
	}
	function CoTToolGroup() {
		const data = DIL.useAppData((data$1) => data$1);
		const [expanded, setExpanded] = DIL.useState(false);
		const lastItem = data.items[data.items.length - 1];
		const headerItem = data.isActive ? lastItem : void 0;
		const currentStatus = data.isActive ? data.current_status : void 0;
		const singleItem = data.items.length === 1 ? data.items[0] : null;
		if (singleItem != null) return /* @__PURE__ */ __dil.jsx(Activity, {
			key: singleItem.id,
			item: singleItem,
			currentStatus,
			isActive: data.isActive,
			autoExpand: data.isActive,
			indentDetails: true
		});
		const groupContent = expanded ? /* @__PURE__ */ __dil.jsx(NestedContent, {
			key: "tool-group-content",
			indentItems: true
		}, data.items.map((item, index) => /* @__PURE__ */ __dil.jsx(Activity, {
			key: item.id,
			item,
			isActive: item.isActive,
			autoExpand: data.isActive && index === data.items.length - 1
		}))) : headerItem != null && hasResourceCards(headerItem) ? /* @__PURE__ */ __dil.jsx(NestedContent, { key: \`tool-group-header-details-\${headerItem.id}\` }, /* @__PURE__ */ __dil.jsx(ActivityDetails, {
			item: headerItem,
			topPadding: 0,
			withGuide: true
		})) : false;
		return /* @__PURE__ */ __dil.jsx("col", {
			gap: 0,
			align: "start",
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx(ActivityLabel, {
			key: lastItem?.type === "web_search" ? \`tool-group-header-\${lastItem.id}\` : void 0,
			title: currentStatus ?? data.title,
			numResources: lastItem?.resources?.length,
			animateCount: currentStatus == null && lastItem?.type === "web_search",
			isActive: data.isActive,
			icon: data.icon,
			expanded,
			onToggle: data.items.length > 0 ? () => setExpanded(!expanded) : void 0
		}), /* @__PURE__ */ __dil.jsx(ExpandableContent, {
			revealAfterResize: headerItem != null && hasResourceCards(headerItem),
			slideUpOnEnter: !expanded && headerItem != null && hasResourceCards(headerItem),
			slideDownOnExit: expanded && headerItem != null && hasResourceCards(headerItem)
		}, groupContent));
	}
	function Activity({ item, currentStatus, isActive, autoExpand = false, indentDetails = false }) {
		const [userExpanded, setUserExpanded] = DIL.useState(false);
		const hasDetails = hasActivityDetails(item);
		const expanded = hasDetails && (autoExpand || userExpanded);
		return /* @__PURE__ */ __dil.jsx("col", {
			gap: 0,
			align: "start",
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx(ActivityLabel, {
			title: currentStatus ?? item.label,
			numResources: item.resources?.length,
			animateCount: currentStatus == null && item.type === "web_search",
			isActive,
			icon: item.icon,
			expanded,
			onToggle: hasDetails && !autoExpand ? () => setUserExpanded(!userExpanded) : void 0
		}), hasDetails && /* @__PURE__ */ __dil.jsx(ExpandableContent, null, expanded && /* @__PURE__ */ __dil.jsx(NestedContent, {
			key: "activity-details",
			topPadding: indentDetails ? 3 : 0,
			bottomPadding: indentDetails ? 3 : 0,
			showGuide: indentDetails
		}, /* @__PURE__ */ __dil.jsx(ActivityDetails, {
			item,
			topPadding: indentDetails ? 0 : 3,
			withGuide: indentDetails
		}))));
	}
	function NestedContent({ children, topPadding = 3, bottomPadding = 0, indentItems = false, showGuide = true }) {
		return /* @__PURE__ */ __dil.jsx("row", {
			width: "100%",
			gap: showGuide ? 1 : 0,
			align: "stretch",
			padding: {
				top: topPadding,
				bottom: bottomPadding
			}
		}, /* @__PURE__ */ __dil.jsx("row", {
			width: 20,
			flex: "0 0 auto",
			justify: "center",
			gap: 0,
			ariaHidden: true
		}, showGuide && /* @__PURE__ */ __dil.jsx("divider", {
			color: "default",
			spacing: 0
		})), /* @__PURE__ */ __dil.jsx("col", {
			gap: 3,
			flex: 1,
			minWidth: 0,
			padding: {
				left: indentItems ? 2 : 0,
				bottom: indentItems ? 2 : 0
			}
		}, children));
	}
	function ActivityDetails({ item, topPadding = 3, withGuide }) {
		const search = item.type === "web_search" ? item : void 0;
		const emails = item.resources?.filter((resource) => resource.type === "email_source");
		const events = item.resources?.filter((resource) => resource.type === "calendar_source");
		const hasSourceCards = !!emails?.length || !!events?.length;
		return /* @__PURE__ */ __dil.jsx("box", {
			padding: {
				top: topPadding,
				left: hasSourceCards || search != null ? withGuide ? 1 : 2 : 0,
				right: hasSourceCards ? 4 : 0
			},
			width: "100%"
		}, search != null && /* @__PURE__ */ __dil.jsx(WebSearchDetails, { item: search }), !!emails?.length && /* @__PURE__ */ __dil.jsx(EmailSources, {
			sources: emails,
			label: item.label
		}), !!events?.length && /* @__PURE__ */ __dil.jsx(CalendarSources, {
			sources: events,
			label: item.label
		}));
	}
	function hasActivityDetails(item) {
		return hasResourceCards(item) || item.type === "web_search" && (!!item.queries?.length || item.pattern != null);
	}
	function hasResourceCards(item) {
		return !!item.resources?.some((resource) => resource.type === "email_source" || resource.type === "calendar_source" || item.type === "web_search" && resource.type === "web_search_source");
	}
	function ExpandableContent({ children, revealAfterResize = false, slideUpOnEnter = false, slideDownOnExit = false }) {
		return /* @__PURE__ */ __dil.jsx("box", { width: "100%" }, /* @__PURE__ */ __dil.jsx("transition", {
			dimension: "height",
			initial: {
				opacity: revealAfterResize ? 0 : 1,
				translateY: slideUpOnEnter ? 4 : 0
			},
			enter: {
				opacity: 1,
				translateY: 0,
				duration: slideUpOnEnter ? 200 : revealAfterResize ? 150 : 0,
				delay: slideUpOnEnter ? 100 : revealAfterResize ? 300 : 0
			},
			exit: {
				opacity: revealAfterResize ? 0 : 1,
				translateY: slideDownOnExit ? 4 : 0,
				duration: slideUpOnEnter ? 100 : slideDownOnExit ? 150 : 0,
				delay: 0
			},
			layoutEnter: {
				duration: 300,
				delay: 0,
				timingFunction: "ease-in-out"
			},
			layoutExit: {
				duration: 300,
				delay: 0,
				timingFunction: "ease-in-out"
			},
			layoutMove: {
				duration: revealAfterResize ? 300 : 0,
				delay: 0,
				timingFunction: "ease-in-out"
			},
			hideOverflow: true,
			preventInitialTransition: true
		}, children));
	}

//#endregion
return CoTToolGroup;
})();
return __dilDefaultExport;
})()`},S={formatVersion:1,library:`cot`,releaseId:`c8d0bfd00f8f1c880343946f86ad30b859236e68933f54c0971eb53cfef4bb8e`}})))()}var w;function T(){return(T=e((()=>{t(),w=m({formatVersion:s(1),library:s(`cot`),releaseId:a().regex(/^[a-f0-9]{64}$/),components:p(a(),a())})})))()}async function E(e,t){let n=D.safeParse(e);if(!n.success||n.data.release==null)return k;let r=n.data.release;if(t?.url===r.url&&t.release.releaseId===r.releaseId)return{release:t.release};try{let e=await fetch(r.url,{credentials:`omit`,redirect:`error`,referrerPolicy:`no-referrer`,signal:AbortSignal.timeout(3e3)});if(!e.ok)throw Error(`CoT release request failed`);let t=w.parse(await e.json());if(t.releaseId!==r.releaseId)throw Error(`CoT release ID mismatch`);return{release:t,cacheEntry:{url:r.url,release:t}}}catch{return k}}var D,O,k;function A(){return(A=e((()=>{C(),T(),t(),D=f({release:f({releaseId:a(),url:r().startsWith(`https://persistent.oaistatic.com/codex/dil/cot/v1/`)}).nullish()}),O=f({url:a(),release:w}),k={release:{...S,components:x}}})))()}function j(e){let t=(0,M.c)(2),n;t[0]===e?n=t[1]:(n={enabled:e},t[0]=e,t[1]=n),i(P,n)}var M,N,P,F,I,L;function R(){return(R=e((()=>{M=l(),u(),n(),g(),_(),v(),A(),N=h(`dil-cot-release-cache`,null,{coerceStoredValue:e=>O.safeParse(e).data??null}),P=c(o,({get:e,scope:t})=>{let n=e(b,`4023951618`)?.value??{};return{queryKey:[`dil-cot-release-current`,n],queryFn:async()=>{let e=await E(n,t.get(N));if(e.cacheEntry!=null)try{t.set(N,e.cacheEntry)}catch{}return e},networkMode:`always`,staleTime:1/0,gcTime:6e4,retry:!1,refetchOnMount:!1,refetchOnReconnect:!1,refetchOnWindowFocus:!1}}),F=d(y,()=>crypto.randomUUID(),{getServerSnapshot:()=>`server`}),I=d(y,null),L=c(y,({get:e,scope:t})=>({queryKey:[`dil-cot-release`,e(F)],queryFn:async()=>{let e=t.get(I);if(e!=null)return e;let n=await t.query.fetch(P);return t.set(I,n),n},networkMode:`always`,staleTime:1/0,gcTime:6e4,retry:!1,refetchOnMount:!1,refetchOnReconnect:!1,refetchOnWindowFocus:!1}))})))()}export{R as n,j as r,L as t};
//# sourceMappingURL=release-state-e8ca26c33040.js.map