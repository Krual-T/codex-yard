import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";import{n as t,u as n}from"./visualization-sandbox-config-193a3a874c91.js";import{a as r,t as i}from"./visualization-theme-bedd32a367a0.js";import{n as a,t as o}from"./visualization-sandbox-html-b6985ba8aa1f.js";var s;function c(){return(c=e((()=>{s=`(() => {
  const configuration = document.getElementById("visualization-share");
  const frame = document.getElementById("codex-visualization");
  if (configuration == null || !(frame instanceof HTMLIFrameElement)) {
    return;
  }
  let config;
  try {
    config = JSON.parse(configuration.textContent);
  } catch {
    return;
  }
  const metadata = config.metadata ?? {};
  const labels = config.labels;
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (typeof text === "string") {
      node.textContent = text;
    }
    return node;
  };
  const link = (href, text, className) => {
    const node = element("a", className, text);
    node.href = href;
    node.target = "_blank";
    node.rel = "noopener noreferrer";
    return node;
  };
  const safeUrl = (value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password
        ? url.href
        : null;
    } catch {
      return null;
    }
  };

  // Bundle the reviewed vectors so portable Python/Work exports need no icon
  // package or network request. Geometry comes from these canonical assets:
  // codex/codex-apps/webview/src/icons/chatgpt-wordmark.svg
  // plugins/visualize/assets/visualize.svg and visualize-dark.svg (theme-aware paint)
  // @oai/icons 0.8.65: {sources,arrow-curvedpath-left-md,table,file-code-square,document}-light-20
  // @oai/icons/chevron-right-sm-light-16
  const icons = {
    wordmark:
      '<svg\\n  width="357"\\n  height="62"\\n  viewBox="0 0 357 62"\\n  fill="none"\\n  role="img"\\n  focusable="false"\\n  xmlns="http://www.w3.org/2000/svg"\\n>\\n  <title>ChatGPT</title>\\n  <path\\n    d="M30.8694 50.7428C19.9894 50.7428 12.4244 42.4978 12.4244 31.1078C12.4244 19.7178 19.9894 11.4728 30.6994 11.4728C38.5194 11.4728 44.5544 16.0628 46.3394 21.6728H58.4944C56.3694 9.43281 44.8944 0.507812 30.5294 0.507812C13.2744 0.507812 0.609375 14.1928 0.609375 31.1078C0.609375 48.0228 12.9344 61.7078 30.6144 61.7078C45.2344 61.7078 56.4544 52.9528 58.7494 40.5428H46.6794C44.6394 46.2378 38.6894 50.7428 30.8694 50.7428Z"\\n    fill="currentColor"\\n  />\\n  <path\\n    d="M88.586 17.5094C82.976 17.5094 78.556 19.9744 76.091 23.3744V1.35938H65.041V60.8594H76.091V37.9944C76.091 31.3644 79.661 27.0294 85.441 27.0294C90.711 27.0294 93.686 31.1094 93.686 36.8044V60.8594H104.736V35.0194C104.736 24.4794 98.276 17.5094 88.586 17.5094Z"\\n    fill="currentColor"\\n  />\\n  <path\\n    d="M150.04 33.1478C150.04 23.4578 143.41 17.5078 131.17 17.5078C121.14 17.5078 113.15 23.1178 111.79 31.2778H122.925C123.775 28.4728 126.835 26.2628 131.085 26.2628C136.61 26.2628 139.245 29.1528 139.245 34.1678V34.4228L128.45 35.3578C117.145 36.2928 110.855 40.8828 110.855 49.5528C110.855 56.8628 117.145 61.7078 125.9 61.7078C131.765 61.7078 137.46 59.4128 139.84 55.5878C139.84 57.4578 140.01 59.1578 140.35 60.8578H150.635C150.21 58.1378 150.04 54.9928 150.04 51.3378V33.1478ZM139.245 43.2628C139.245 48.2778 135.505 53.3778 127.94 53.3778C123.86 53.3778 121.65 51.4228 121.65 48.5328C121.65 45.3878 123.775 43.4328 128.535 43.0078L139.245 42.0728V43.2628Z"\\n    fill="currentColor"\\n  />\\n  <path\\n    d="M173.245 4.58984H162.195V18.3598H153.355V27.2848H162.195V48.1948C162.195 56.2698 166.36 60.8598 175.285 60.8598H184.125V51.6798H178.515C174.775 51.6798 173.245 50.4048 173.245 46.9198V27.2848H184.125V18.3598H173.245V4.58984Z"\\n    fill="currentColor"\\n  />\\n  <path\\n    d="M239.033 29.0678H219.993V38.5878H236.228C235.123 46.4928 227.728 51.2528 219.483 51.2528C207.583 51.2528 200.613 42.4978 200.613 31.1078C200.613 19.7178 208.433 11.3878 219.143 11.3878C226.453 11.3878 232.403 15.6378 233.933 20.3978H246.088C243.793 8.58281 232.913 0.507812 218.973 0.507812C201.803 0.507812 189.053 14.3628 189.053 31.1928C189.053 48.0228 200.783 61.7078 218.293 61.7078C226.283 61.7078 233.508 58.1378 236.738 53.2928V60.8578H246.598V36.6328C246.598 31.7878 243.878 29.0678 239.033 29.0678Z"\\n    fill="currentColor"\\n  />\\n  <path\\n    d="M281.703 1.35938H255.354V60.8594H266.573V38.5044H281.789C293.519 38.5044 301.849 31.6194 301.849 20.0594C301.849 8.49937 293.518 1.35938 281.703 1.35938ZM280.939 28.6444H266.573V11.5594H280.939C286.719 11.5594 290.458 14.8744 290.458 20.0594C290.458 25.2444 286.719 28.6444 280.939 28.6444Z"\\n    fill="currentColor"\\n  />\\n  <path\\n    d="M304.652 1.35938V11.5594H324.967V60.8594H336.187V11.5594H356.587V1.35938H304.652Z"\\n    fill="currentColor"\\n  />\\n</svg>',
    visualize:
      '<svg\\n  xmlns="http://www.w3.org/2000/svg"\\n  width="24"\\n  height="24"\\n  fill="none"\\n  viewBox="0 0 24 24"\\n>\\n  <path\\n    fill="light-dark(white, #EBEBEB)"\\n    d="M6.95984 4H17.0402C17.706 3.99999 18.2656 3.99997 18.7234 4.03738C19.2022 4.0765 19.6571 4.16144 20.089 4.38148C20.7475 4.71703 21.283 5.25247 21.6185 5.91103C21.8386 6.34289 21.9235 6.79785 21.9626 7.27657C22 7.73444 22 8.29396 22 8.95982V15.0402C22 15.706 22 16.2656 21.9626 16.7234C21.9235 17.2021 21.8386 17.6571 21.6185 18.089C21.283 18.7475 20.7475 19.283 20.089 19.6185C19.6571 19.8386 19.2021 19.9235 18.7234 19.9626C18.2656 20 17.706 20 17.0402 20H6.95982C6.29396 20 5.73444 20 5.27657 19.9626C4.79785 19.9235 4.34289 19.8386 3.91103 19.6185C3.25247 19.283 2.71704 18.7475 2.38148 18.089C2.16144 17.6571 2.0765 17.2021 2.03738 16.7234C1.99997 16.2656 1.99999 15.706 2 15.0402V8.95984C1.99999 8.29397 1.99997 7.73445 2.03738 7.27657C2.0765 6.79785 2.16144 6.34289 2.38148 5.91103C2.71704 5.25247 3.25247 4.71704 3.91103 4.38148C4.34289 4.16144 4.79785 4.0765 5.27657 4.03738C5.73445 3.99997 6.29397 3.99999 6.95984 4Z"\\n  />\\n  <rect x="3" y="5" width="18" height="14" rx="2.5" fill="light-dark(#2E9EFF, #68C4FF)" />\\n  <path\\n    fill="#F5F5F5"\\n    d="M11.2952 7.93832C11.5345 7.28007 12.4655 7.28007 12.7048 7.93832L13.4804 10.0711C13.5562 10.2796 13.7204 10.4438 13.9289 10.5196L16.0617 11.2952C16.7199 11.5345 16.7199 12.4655 16.0617 12.7048L13.9289 13.4804C13.7204 13.5562 13.5562 13.7204 13.4804 13.9289L12.7048 16.0617C12.4655 16.7199 11.5345 16.7199 11.2952 16.0617L10.5196 13.9289C10.4438 13.7204 10.2796 13.5562 10.0711 13.4804L7.93832 12.7048C7.28007 12.4655 7.28007 11.5345 7.93832 11.2952L10.0711 10.5196C10.2796 10.4438 10.4438 10.2796 10.5196 10.0711L11.2952 7.93832Z"\\n  />\\n</svg>',
    sources:
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M14.4365 2.25244C16.2993 2.25257 17.8104 3.76268 17.8105 5.62549C17.8105 7.48845 16.2995 8.99938 14.4365 8.99951C12.8756 8.99936 11.5624 7.9384 11.1777 6.49854H8.75C8.33552 6.49867 8.08566 6.70063 8.00391 6.88428C7.93983 7.02847 7.8974 7.36151 8.37109 7.84424L12.5283 11.1704L12.5537 11.1958C13.3113 11.9535 13.5635 12.8643 13.2119 13.6558C12.8769 14.4089 12.0854 14.8313 11.251 14.8315H8.86914C8.66988 16.5047 7.24717 17.8032 5.52051 17.8032C3.65778 17.803 2.14772 16.2919 2.14746 14.4292C2.14764 12.5664 3.65773 11.0563 5.52051 11.0562C7.06179 11.0562 8.36147 12.0895 8.76465 13.5015H11.251C11.6654 13.5012 11.9155 13.2984 11.9971 13.1147C12.0609 12.9704 12.1026 12.6381 11.6309 12.1567L7.50195 8.85205L7.47266 8.82959L7.44727 8.80322C6.6895 8.04545 6.4373 7.1358 6.78906 6.34424C7.12406 5.59088 7.9154 5.16859 8.75 5.16846H11.0957C11.319 3.52195 12.7288 2.2526 14.4365 2.25244ZM5.52051 12.3862C4.39226 12.3864 3.47771 13.301 3.47754 14.4292C3.4778 15.5574 4.39232 16.473 5.52051 16.4731C6.64885 16.4731 7.56419 15.5575 7.56445 14.4292C7.56428 13.3008 6.6489 12.3862 5.52051 12.3862ZM14.4365 3.58252C13.3083 3.5827 12.3937 4.49724 12.3936 5.62549C12.3936 6.75388 13.3082 7.66926 14.4365 7.66943C15.5649 7.6693 16.4805 6.75391 16.4805 5.62549C16.4803 4.49722 15.5648 3.58265 14.4365 3.58252Z" fill="currentColor"/></svg>',
    back: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M14.9587 6.00146C15.3258 6.00168 15.6237 6.29937 15.6237 6.6665V9.16064C15.6237 9.81272 15.4102 10.4093 14.9753 10.8442C14.5404 11.2791 13.9437 11.4926 13.2917 11.4927H6.59834L7.96944 12.8628C8.22914 13.1225 8.22914 13.5445 7.96944 13.8042C7.70971 14.0635 7.28761 14.0638 7.02803 13.8042L4.88252 11.6577C4.42772 11.2029 4.42794 10.4643 4.88252 10.0093L7.02803 7.86279C7.28772 7.60311 7.70974 7.60313 7.96944 7.86279C8.22914 8.12249 8.22914 8.5445 7.96944 8.8042L6.61006 10.1626H13.2917C13.6528 10.1625 13.89 10.0487 14.0349 9.90381C14.1797 9.75883 14.2937 9.52183 14.2937 9.16064V6.6665C14.2937 6.29923 14.5914 6.00146 14.9587 6.00146Z" fill="currentColor"/></svg>',
    table:
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M15.167 3.08496C16.8227 3.08514 18.1649 4.42733 18.165 6.08301V13.917C18.1649 15.5727 16.8227 16.9149 15.167 16.915H4.83301C3.17733 16.9149 1.83514 15.5727 1.83496 13.917V6.08301C1.83514 4.42733 3.17733 3.08514 4.83301 3.08496H15.167ZM10.665 15.585H15.167C16.0881 15.5848 16.8348 14.8381 16.835 13.917V8.99805H10.665V15.585ZM3.16504 13.917C3.16522 14.8381 3.91187 15.5848 4.83301 15.585H9.33496V8.99805H3.16504V13.917ZM4.83301 4.41504C3.91187 4.41521 3.16521 5.16187 3.16504 6.08301V7.66797H16.835V6.08301C16.8348 5.16187 16.0881 4.41522 15.167 4.41504H4.83301Z" fill="currentColor"/></svg>',
    code: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M6.20166 7.42334C6.42204 7.12958 6.83951 7.07018 7.1333 7.29053C7.4269 7.51094 7.48641 7.92844 7.26611 8.22217L5.93213 9.99951L7.26611 11.7788C7.486 12.0726 7.42684 12.4892 7.1333 12.7095C6.83956 12.9298 6.42207 12.8703 6.20166 12.5767L4.56885 10.3989C4.39171 10.1626 4.39169 9.83744 4.56885 9.60107L6.20166 7.42334Z" fill="currentColor"/> <path d="M10.4946 7.5249C10.6591 7.19696 11.058 7.06395 11.3862 7.22803C11.7144 7.39235 11.8481 7.79225 11.6841 8.12061L9.50635 12.4751C9.34207 12.8033 8.94212 12.9359 8.61377 12.772C8.28569 12.6076 8.15292 12.2087 8.31689 11.8804L10.4946 7.5249Z" fill="currentColor"/> <path d="M12.8667 7.29053C13.1605 7.07024 13.578 7.12967 13.7983 7.42334L15.4312 9.60107C15.6082 9.83745 15.6083 10.1626 15.4312 10.3989L13.7983 12.5767C13.578 12.8703 13.1605 12.9296 12.8667 12.7095C12.5732 12.4892 12.5139 12.0725 12.7339 11.7788L14.0669 9.99951L12.7339 8.22217C12.5136 7.9284 12.573 7.51092 12.8667 7.29053Z" fill="currentColor"/> <path fill-rule="evenodd" clip-rule="evenodd" d="M14.7495 2.25146C16.4053 2.25146 17.7484 3.59373 17.7485 5.24951V14.7495C17.7485 16.4054 16.4054 17.7485 14.7495 17.7485H5.24951C3.59373 17.7484 2.25146 16.4053 2.25146 14.7495V5.24951C2.25164 3.59384 3.59384 2.25164 5.24951 2.25146H14.7495ZM5.24951 3.58154C4.32837 3.58172 3.58172 4.32838 3.58154 5.24951V14.7495C3.58154 15.6708 4.32827 16.4183 5.24951 16.4185H14.7495C15.6709 16.4185 16.4185 15.6709 16.4185 14.7495V5.24951C16.4183 4.32827 15.6708 3.58154 14.7495 3.58154H5.24951Z" fill="currentColor"/></svg>',
    document:
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M11.8809 2.25171C12.7202 2.25171 13.5256 2.585 14.1191 3.17847L15.9883 5.04761C16.5817 5.64115 16.915 6.44654 16.915 7.28589V14.5837C16.9149 16.3316 15.4979 17.7488 13.75 17.7488H6.25C4.50213 17.7488 3.08514 16.3316 3.08496 14.5837V5.41675C3.08496 3.66877 4.50202 2.25171 6.25 2.25171H11.8809ZM6.25 3.58179C5.23656 3.58179 4.41504 4.40331 4.41504 5.41675V14.5837C4.41521 15.597 5.23667 16.4187 6.25 16.4187H13.75C14.7633 16.4187 15.5848 15.597 15.585 14.5837V8.58179H13.334C12.0463 8.58179 11.0021 7.53739 11.002 6.24976V3.58179H6.25ZM12.332 6.24976C12.3322 6.80285 12.7809 7.25171 13.334 7.25171H15.583C15.5742 6.77746 15.3838 6.32408 15.0479 5.98804L13.1787 4.1189C12.9432 3.8834 12.6496 3.71992 12.332 3.6394V6.24976Z" fill="currentColor"/></svg>',
    chevron:
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6.29561 10.2954C6.09064 10.5003 6.09075 10.8325 6.29561 11.0376C6.50064 11.2426 6.83278 11.2426 7.0378 11.0376L9.46847 8.60689C9.80367 8.27169 9.80367 7.72823 9.46847 7.39303L7.0378 4.96236C6.83278 4.75734 6.50064 4.75734 6.29561 4.96236C6.09059 5.16739 6.09059 5.49952 6.29561 5.70455L8.59054 7.99947L6.29561 10.2954Z" fill="currentColor"/></svg>',
  };
  const icon = (svg, className = "visualization-share-icon") => {
    const node = document.importNode(
      new DOMParser().parseFromString(svg, "image/svg+xml").documentElement,
      true,
    );
    node.setAttribute("class", className);
    node.setAttribute("aria-hidden", "true");
    node.setAttribute("focusable", "false");
    return node;
  };

  document.documentElement.classList.add("visualization-share-root");
  document.body.classList.add("visualization-share-page");
  const brand = element("header", "visualization-share-brand");
  const home = link("https://chatgpt.com/");
  home.setAttribute("aria-label", "ChatGPT");
  home.append(icon(icons.wordmark, "visualization-share-wordmark"));
  brand.append(home);
  const main = element("main", "visualization-share-main");
  const article = element("article", "visualization-share-object");
  const card = element("div", "visualization-share-card");
  const chart = element(
    "section",
    "visualization-share-face visualization-share-chart",
  );
  chart.id = "visualization-share-chart";
  chart.setAttribute("aria-label", frame.title);
  chart.setAttribute("aria-hidden", "false");
  const content = element("div", "visualization-share-content");
  content.append(frame);
  chart.append(content);
  card.append(chart);

  const footer = element("footer", "visualization-share-footer");
  const attribution = element("p", "visualization-share-attribution");
  const authorName =
    typeof metadata.authorName === "string" ? metadata.authorName : "";
  const attributionLabel = authorName ? labels.madeBy : labels.madeWith;
  for (const part of attributionLabel.split(/(\\{visualize\\})/)) {
    if (part === "{visualize}") {
      const growth = link(
        "https://chatgpt.com/?prompt=%40visualize",
        "Visualize",
        "visualization-share-growth",
      );
      growth.prepend(icon(icons.visualize, "visualization-share-logo"));
      attribution.append(growth);
    } else if (part.trim()) {
      attribution.append(
        element(
          "span",
          "",
          part.replaceAll("{author}", () => authorName).trim(),
        ),
      );
    }
  }
  footer.append(attribution);
  const sources = Array.isArray(metadata.sources) ? metadata.sources : [];
  if (sources.length > 0) {
    const panel = element(
      "section",
      "visualization-share-face visualization-share-sources",
    );
    panel.id = "visualization-share-sources";
    panel.inert = true;
    panel.hidden = true;
    panel.setAttribute("aria-hidden", "true");
    const sourceContent = element("div", "visualization-share-content");
    const header = element("div", "visualization-share-sources-header");
    const heading = element("h2", "", labels.sources);
    heading.id = "visualization-share-sources-heading";
    panel.setAttribute("aria-labelledby", heading.id);
    header.append(heading);
    sourceContent.append(header);
    for (const source of sources) {
      if (typeof source.title !== "string") {
        continue;
      }
      const row = element("details", "visualization-share-source");
      const summary = element("summary");
      const documentIcon = element("span", "visualization-share-source-icon");
      const type =
        typeof source.type === "string" ? source.type.toLowerCase() : "";
      let sourceIcon = icons.document;
      if (type === "saved query" || type === "query" || type === "code") {
        sourceIcon = icons.code;
      } else if (
        type === "dataset" ||
        type === "table" ||
        type === "spreadsheet"
      ) {
        sourceIcon = icons.table;
      }
      documentIcon.append(icon(sourceIcon));
      const text = element("span", "visualization-share-source-heading");
      text.append(
        element("span", "visualization-share-source-title", source.title),
      );
      const context = [source.provider, source.type, source.date]
        .filter((value) => typeof value === "string" && value.length > 0)
        .join(" · ");
      if (context) {
        text.append(
          element("span", "visualization-share-source-context", context),
        );
      }
      summary.append(
        documentIcon,
        text,
        icon(icons.chevron, "visualization-share-chevron"),
      );
      row.append(summary);
      if (typeof source.description === "string" && source.description) {
        row.append(
          element(
            "p",
            "visualization-share-source-description",
            source.description,
          ),
        );
      }
      const url = safeUrl(source.url);
      if (url != null) {
        row.append(
          link(url, labels.openSource, "visualization-share-source-link"),
        );
      }
      sourceContent.append(row);
    }
    panel.append(sourceContent);
    card.append(panel);
    const showSources = element(
      "button",
      "visualization-share-toggle",
      labels.sources,
    );
    showSources.type = "button";
    showSources.setAttribute("aria-controls", panel.id);
    showSources.setAttribute("aria-expanded", "false");
    showSources.prepend(icon(icons.sources));
    const showChart = element(
      "button",
      "visualization-share-toggle",
      labels.backToChart,
    );
    showChart.type = "button";
    showChart.setAttribute("aria-controls", chart.id);
    showChart.hidden = true;
    showChart.prepend(icon(icons.back));
    const hideInactiveSources = () => {
      if (!chart.inert && card.getAnimations().length === 0) {
        panel.hidden = true;
      }
    };
    const flip = (show) => {
      // Keep the iframe mounted and the outgoing sources at their full height
      // until the flip finishes. Hidden sources must not size the chart.
      if (show) {
        panel.hidden = false;
      }
      card.classList.toggle("visualization-share-flipped", show);
      showSources.hidden = show;
      showChart.hidden = !show;
      chart.inert = show;
      panel.inert = !show;
      chart.setAttribute("aria-hidden", String(show));
      panel.setAttribute("aria-hidden", String(!show));
      showSources.setAttribute("aria-expanded", String(show));
      (show ? showChart : showSources).focus({ preventScroll: true });
      hideInactiveSources();
    };
    for (const eventType of ["transitionend", "transitioncancel"]) {
      card.addEventListener(eventType, (event) => {
        if (event.target === card) {
          hideInactiveSources();
        }
      });
    }
    showSources.addEventListener("click", () => flip(true));
    showChart.addEventListener("click", () => flip(false));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && chart.inert) {
        event.preventDefault();
        flip(false);
      }
    });
    const controls = element("div", "visualization-share-controls");
    controls.append(showSources, showChart);
    footer.append(controls);
  }
  article.append(card, footer);
  main.append(article);
  document.body.prepend(brand, main);
})();
`})))()}var l;function u(){return(u=e((()=>{l=`(() => {
  const root = document.documentElement;
  const mediaQuery = globalThis.matchMedia("(prefers-color-scheme: dark)");
  const apply = Reflect.apply;
  const isArray = Array.isArray;
  const hasOwn = Object.hasOwn;
  const parentWindow = globalThis.parent;
  const stringify = JSON.stringify;
  const parse = JSON.parse;
  const encode = TextEncoder.prototype.encode.bind(new TextEncoder());
  const initialStateElement = document.getElementById(
    "codex-visualization-widget-state",
  );
  const initialGlobals = parse(initialStateElement?.textContent ?? "{}");
  initialStateElement?.remove();
  /** @type {Record<string, unknown> | null} */
  let state = initialGlobals.widgetState ?? null;
  const statePersistence = initialGlobals.statePersistence ?? "none";
  let nextStateRequestId = 0;
  /** @type {Map<number, { resolve: () => void; reject: (error: Error) => void; timeout: ReturnType<typeof globalThis.setTimeout>; serializedState: string }>} */
  const pendingStateWrites = new Map();
  const persistenceError = () =>
    Object.assign(
      new Error("The host could not persist the widget state update"),
      {
        code: -32000,
        data: { code: "widget_state_persistence_failed", retryable: false },
      },
    );
  /**
   * @param {object} prototype
   * @param {string} property
   */
  const getPrototypeGetter = (prototype, property) => {
    // oxlint-disable-next-line typescript/unbound-method -- invoked through captured Reflect.apply
    const getter = Object.getOwnPropertyDescriptor(prototype, property)?.get;
    if (getter == null) {
      throw new Error(\`Missing \${property} getter\`);
    }
    return getter;
  };
  const getMessageData = getPrototypeGetter(MessageEvent.prototype, "data");
  const getMessagePorts = getPrototypeGetter(MessageEvent.prototype, "ports");
  const getMessageSource = getPrototypeGetter(MessageEvent.prototype, "source");
  // oxlint-disable-next-line typescript/unbound-method -- captured before the untrusted fragment runs
  const addHostMessageListener = MessagePort.prototype.addEventListener;
  // oxlint-disable-next-line typescript/unbound-method -- captured before the untrusted fragment runs
  const postHostMessage = MessagePort.prototype.postMessage;
  // oxlint-disable-next-line typescript/unbound-method -- captured before the untrusted fragment runs
  const startHostPort = MessagePort.prototype.start;
  // oxlint-disable-next-line typescript/unbound-method -- captured before the untrusted fragment runs
  const stopMessagePropagation = Event.prototype.stopImmediatePropagation;
  /** @type {MessagePort | null} */
  let hostPort = null;
  const postToHost = (type, payload) => {
    if (hostPort != null) {
      apply(postHostMessage, hostPort, [{ type, ...payload }]);
    }
  };
  const openExternal = ({ href }) => {
    if (globalThis.navigator.userActivation?.isActive === true) {
      postToHost("open-external", { href });
    }
  };
  const sendFollowUpMessage = ({ context, prompt, title }) => {
    if (globalThis.navigator.userActivation?.isActive === true) {
      postToHost("follow-up", { context, prompt, title });
    }
    return Promise.resolve();
  };
  /**
   * @param {Record<string, unknown> | ((previous: Record<string, unknown> | null) => Record<string, unknown>)} next
   * @returns {Promise<void>}
   */
  const setWidgetState = async (next) => {
    const nextState = typeof next === "function" ? next(state) : next;
    if (
      nextState == null ||
      typeof nextState !== "object" ||
      isArray(nextState)
    ) {
      throw new TypeError("Widget state must be a JSON object");
    }
    const inputState = stringify(
      nextState,
      (_key, /** @type {unknown} */ value) => {
        if (
          typeof value === "undefined" ||
          typeof value === "function" ||
          typeof value === "symbol" ||
          (typeof value === "number" && !Number.isFinite(value))
        ) {
          throw new TypeError("Widget state must be a JSON object");
        }
        return value;
      },
    );
    const parsedState = parse(inputState);
    if (
      parsedState == null ||
      typeof parsedState !== "object" ||
      isArray(parsedState)
    ) {
      throw new TypeError("Widget state must be a JSON object");
    }
    const storedState = {
      modelContent: null,
      privateContent: null,
      ...parsedState,
    };
    const serializedState = stringify(storedState);
    if (encode(serializedState).length > 16 * 1024) {
      throw new TypeError(
        "Widget state must be a JSON object of at most 16 KiB",
      );
    }
    if (
      hasOwn(storedState, "imageIds") &&
      (!isArray(storedState.imageIds) ||
        storedState.imageIds.some(
          (/** @type {unknown} */ id) => typeof id !== "string",
        ))
    ) {
      throw new TypeError("Widget state imageIds must be an array of strings");
    }
    if (storedState.imageIds?.length > 0) {
      throw Object.assign(
        new TypeError("Visualization state does not support image attachments"),
        { code: -32602, data: { code: "images_unsupported" } },
      );
    }
    state = storedState;
    globalThis.openai.widgetState = state;
    globalThis.dispatchEvent(
      new CustomEvent("openai:set_globals", {
        detail: { globals: { widgetState: state } },
      }),
    );
    if (statePersistence === "none") {
      throw persistenceError();
    }
    const id = ++nextStateRequestId;
    return new Promise((resolve, reject) => {
      const timeout = globalThis.setTimeout(() => {
        pendingStateWrites.delete(id);
        reject(persistenceError());
      }, 30_000);
      pendingStateWrites.set(id, { resolve, reject, timeout, serializedState });
      postToHost("widget-state-write", { id, state: serializedState });
    });
  };
  const syncTheme = () => {
    const theme = mediaQuery.matches ? "dark" : "light";
    root.dataset.theme = theme;
    globalThis.openai = {
      ...globalThis.openai,
      openExternal,
      sendFollowUpMessage,
      setWidgetState,
      theme,
      visualizationStyleVariables: {},
      visualizationTheme: theme,
      widgetState: state,
      statePersistence,
      stateModelContext: "none",
    };
    globalThis.dispatchEvent(
      new CustomEvent("openai:set_globals", {
        detail: { globals: globalThis.openai },
      }),
    );
  };
  const sendHeight = () => {
    postToHost("height", {
      height: Math.ceil(
        Math.max(
          document.body.scrollHeight,
          document.body.getBoundingClientRect().height,
        ),
      ),
    });
  };

  globalThis.addEventListener(
    "message",
    (event) => {
      const data = apply(getMessageData, event, []);
      const ports = apply(getMessagePorts, event, []);
      const source = apply(getMessageSource, event, []);
      if (
        hostPort != null ||
        source !== parentWindow ||
        typeof data !== "object" ||
        data?.type !== "codex-visualization-initialize" ||
        !isArray(ports) ||
        ports.length !== 1
      ) {
        return;
      }
      apply(stopMessagePropagation, event, []);
      const nextHostPort = ports[0];
      try {
        apply(addHostMessageListener, nextHostPort, [
          "message",
          (event) => {
            const data = apply(getMessageData, event, []);
            if (typeof data === "object" && data?.type === "measure") {
              sendHeight();
            } else if (
              typeof data === "object" &&
              data?.type === "widget-state-result"
            ) {
              /** @type {unknown} */
              const id = data.id;
              if (typeof id !== "number") {
                return;
              }
              const pending = pendingStateWrites.get(id);
              if (pending != null) {
                pendingStateWrites.delete(id);
                globalThis.clearTimeout(pending.timeout);
                if (data.ok === true) {
                  pending.resolve();
                } else {
                  pending.reject(persistenceError());
                }
              }
            }
          },
        ]);
        apply(startHostPort, nextHostPort, []);
      } catch {
        return;
      }
      hostPort = nextHostPort;
      for (const [id, { serializedState }] of pendingStateWrites) {
        postToHost("widget-state-write", { id, state: serializedState });
      }
      sendHeight();
    },
    { capture: true },
  );
  document.currentScript?.remove();
  mediaQuery.addEventListener("change", syncTheme);
  globalThis.addEventListener("click", (event) => {
    if (event.defaultPrevented) {
      return;
    }
    let element = null;
    if (event.target instanceof globalThis.Element) {
      element = event.target;
    } else if (event.target instanceof globalThis.Node) {
      element = event.target.parentElement;
    }
    const link = element?.closest("a[href]");
    const href = link?.getAttribute("href");
    if (href == null) {
      return;
    }
    if (href.startsWith("#")) {
      let id;
      try {
        id = decodeURIComponent(href.slice(1));
      } catch {
        return;
      }
      const target = id.length === 0 ? root : document.getElementById(id);
      if (
        target == null ||
        globalThis.navigator.userActivation?.isActive !== true
      ) {
        return;
      }
      event.preventDefault();
      postToHost("scroll-to", {
        top: target.getBoundingClientRect().top + globalThis.scrollY,
      });
      return;
    }
    event.preventDefault();
    openExternal({ href });
  });
  new ResizeObserver(sendHeight).observe(document.body);
  syncTheme();
})();
`})))()}var d;function f(){return(f=e((()=>{d=`(() => {
  const frame = document.getElementById("codex-visualization");
  if (!(frame instanceof HTMLIFrameElement)) {
    return;
  }
  const isShare = document.documentElement.classList.contains(
    "visualization-share-root",
  );
  let viewportHeight = globalThis.innerHeight;
  let sizeFingerprint = null;
  let sizeWriteTimeout;
  let lastSize = null;
  let pendingSize = null;
  const storageKey = \`codex:visualization-widget-state-v2:\${JSON.stringify([
    globalThis.location.pathname,
    globalThis.location.search,
  ])}\`;
  const sizeStorageKey = \`\${storageKey}:share-size-v1\`;
  const parseState = (serializedState) => {
    if (
      typeof serializedState !== "string" ||
      new TextEncoder().encode(serializedState).length > 16 * 1024
    ) {
      throw new TypeError(
        "Widget state must be a JSON object of at most 16 KiB",
      );
    }
    /** @type {unknown} */
    const state = JSON.parse(serializedState);
    if (
      state == null ||
      typeof state !== "object" ||
      Array.isArray(state) ||
      ("imageIds" in state &&
        (!Array.isArray(state.imageIds) || state.imageIds.length > 0))
    ) {
      throw new TypeError("Widget state must be a JSON object");
    }
    const storedState = { modelContent: null, privateContent: null, ...state };
    const canonicalState = JSON.stringify(
      storedState,
      (_key, /** @type {unknown} */ value) => {
        if (typeof value === "number" && !Number.isFinite(value)) {
          throw new TypeError("Widget state must contain finite numbers");
        }
        return value;
      },
    );
    if (new TextEncoder().encode(canonicalState).length > 16 * 1024) {
      throw new TypeError(
        "Widget state must be a JSON object of at most 16 KiB",
      );
    }
    return storedState;
  };
  let storage = null;
  let state = null;
  try {
    const localStorage = globalThis.localStorage;
    const probeKey = \`\${storageKey}:probe\`;
    localStorage.setItem(probeKey, "1");
    localStorage.removeItem(probeKey);
    storage = localStorage;
    const savedState = storage.getItem(storageKey);
    if (savedState != null) {
      try {
        state = parseState(savedState);
      } catch {
        // Invalid saved state does not disable future writes.
      }
    }
  } catch {
    storage = null;
  }
  const persistSize = () => {
    globalThis.clearTimeout(sizeWriteTimeout);
    if (pendingSize == null) {
      return;
    }
    try {
      storage?.setItem(sizeStorageKey, pendingSize);
    } catch {
      // A denied or full cache must not affect the visualization.
    }
    pendingSize = null;
  };
  if (isShare) {
    globalThis.addEventListener("pagehide", persistSize);
  }
  const initialGlobals = {
    widgetState: state,
    statePersistence: storage == null ? "none" : "local",
  };

  const channel = new MessageChannel();
  channel.port1.addEventListener("message", (event) => {
    const data = event.data;
    if (typeof data !== "object" || data == null) {
      return;
    }
    if (data.type === "widget-state-write") {
      if (!Number.isSafeInteger(data.id) || data.id <= 0) {
        return;
      }
      let ok = false;
      try {
        if (storage != null) {
          const state = parseState(data.state);
          storage.setItem(storageKey, JSON.stringify(state));
          ok = true;
        }
      } catch {
        // Storage denial, quota limits, and invalid state return a failed receipt.
      }
      channel.port1.postMessage({
        type: "widget-state-result",
        id: data.id,
        ok,
      });
      return;
    }
    if (data.type === "height") {
      const height = data.height;
      if (
        typeof height !== "number" ||
        !Number.isFinite(height) ||
        height < 0
      ) {
        return;
      }
      if (height <= 10_000) {
        const width = isShare && storage != null ? frame.clientWidth : null;
        frame.style.height = Math.ceil(height) + "px";
        if (isShare && storage != null) {
          const size = JSON.stringify({
            fingerprint: sizeFingerprint,
            width,
            viewportHeight: globalThis.innerHeight,
            dark: globalThis.matchMedia("(prefers-color-scheme: dark)").matches,
            scale: globalThis.devicePixelRatio,
            height: Math.ceil(height),
          });
          if (size !== lastSize) {
            lastSize = size;
            pendingSize = size;
            globalThis.clearTimeout(sizeWriteTimeout);
            sizeWriteTimeout = globalThis.setTimeout(persistSize, 100);
          }
        }
      }
      if (isShare) {
        // Keep unusually tall content accessible without accepting an unbounded height.
        if (height > 10_000 && Number.parseFloat(frame.style.height) === 0) {
          frame.style.removeProperty("height");
        }
        frame.scrolling = height > 10_000 ? "auto" : "no";
        document.documentElement.classList.add("visualization-share-ready");
      }
      return;
    }
    if (data.type === "scroll-to") {
      const top = data.top;
      if (
        typeof top === "number" &&
        Number.isFinite(top) &&
        top >= 0 &&
        globalThis.navigator.userActivation?.isActive === true
      ) {
        globalThis.scrollTo({
          top: Math.ceil(
            globalThis.scrollY + frame.getBoundingClientRect().top + top,
          ),
        });
      }
      return;
    }
    if (data.type === "open-external") {
      const rawHref = data.href;
      if (typeof rawHref !== "string") {
        return;
      }
      let href;
      try {
        const url = new URL(rawHref, document.baseURI);
        if (url.protocol !== "https:") {
          return;
        }
        href = url.href;
      } catch {
        return;
      }
      if (globalThis.navigator.userActivation?.isActive === true) {
        const anchor = document.createElement("a");
        anchor.href = href;
        anchor.rel = "noopener noreferrer";
        anchor.target = "_blank";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      }
      return;
    }
    if (data.type === "follow-up") {
      const prompt = data.prompt;
      if (
        typeof prompt !== "string" ||
        globalThis.navigator.userActivation?.isActive !== true
      ) {
        return;
      }
      const title = data.title;
      globalThis.prompt(typeof title === "string" ? title : prompt, prompt);
    }
  });
  channel.port1.start();
  const srcdoc = frame.dataset.srcdoc;
  if (srcdoc == null) {
    return;
  }
  globalThis.addEventListener("resize", () => {
    const height = Number.parseFloat(frame.style.height);
    if (!isShare && (!Number.isFinite(height) || height <= viewportHeight)) {
      frame.style.removeProperty("height");
    }
    viewportHeight = globalThis.innerHeight;
    channel.port1.postMessage({ type: "measure" });
  });
  frame.addEventListener(
    "load",
    () => {
      frame.contentWindow?.postMessage(
        { type: "codex-visualization-initialize" },
        "*",
        [channel.port2],
      );
    },
    { once: true },
  );
  // Match the trusted bootstrap element, not the same text in an authored title.
  const frameHtml = srcdoc.replace(
    '<script type="application/json" id="codex-visualization-widget-state">__CODEX_VISUALIZATION_WIDGET_STATE__<\/script>',
    () =>
      '<script type="application/json" id="codex-visualization-widget-state">' +
      JSON.stringify(initialGlobals).replaceAll("<", "\\\\u003c") +
      "<\/script>",
  );
  if (isShare && storage != null) {
    // Fingerprint the rendered document, including restored widget state, without
    // storing its content. This is a layout cache, not a security identity.
    let hash = 5381;
    for (let index = 0; index < frameHtml.length; index += 1) {
      hash = (hash * 33 + frameHtml.charCodeAt(index)) % 4_294_967_296;
    }
    sizeFingerprint = hash.toString(36);
    try {
      const size = JSON.parse(storage.getItem(sizeStorageKey) ?? "null");
      if (
        size?.fingerprint === sizeFingerprint &&
        size.width === frame.clientWidth &&
        size.viewportHeight === globalThis.innerHeight &&
        size.dark ===
          globalThis.matchMedia("(prefers-color-scheme: dark)").matches &&
        size.scale === globalThis.devicePixelRatio &&
        typeof size.height === "number" &&
        Number.isFinite(size.height) &&
        size.height >= 0 &&
        size.height <= 10_000
      ) {
        frame.style.height = size.height + "px";
      }
    } catch {
      // Ignore missing or invalid cache entries and measure the live frame.
    }
  }
  frame.srcdoc = frameHtml;
  delete frame.dataset.srcdoc;
})();
`})))()}var p;function m(){return(m=e((()=>{p=`:root.visualization-share-root {
  --background: light-dark(#fdfdfd, #141414);
  --foreground: light-dark(#222, #ececee);
  --share-surface: light-dark(#fff, #181818);
  --share-outline: light-dark(rgb(0 0 0 / 10%), rgb(255 255 255 / 12%));
  --share-shadow-near: light-dark(#00000003, transparent);
  --share-shadow-far: light-dark(#00000020, transparent);
  --share-divider: light-dark(#efeff1, #343437);
  --share-credit: light-dark(#77777e, #a1a1a8);
  --share-link: light-dark(#006cde, #83c3ff);
  --share-control: light-dark(#65656c, #b5b5bc);
  --share-description: light-dark(#717178, #b5b5bc);
  --share-context: light-dark(#919197, #a1a1a8);
  --share-icon: light-dark(#83838a, #a1a1a8);
  --share-icon-border: light-dark(#e8e8ec, #3a3a3e);
  --share-chevron: light-dark(#a0a0a6, #94949b);
  --share-focus: light-dark(#5291f7, #83c3ff);
  --font-sans: system-ui, sans-serif;
  font-size: 16px;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
.visualization-share-page {
  min-block-size: 100svh;
  padding: 0;
  color: var(--foreground);
  line-height: normal;
}
.visualization-share-brand {
  position: absolute;
  inset-block-start: 28px;
  inset-inline-start: 28px;
  line-height: 0;
}
.visualization-share-brand a {
  display: block;
  color: inherit;
}
.visualization-share-wordmark {
  display: block;
  inline-size: 86.25px;
  block-size: auto;
}
.visualization-share-main {
  display: grid;
  place-items: center;
  min-block-size: 100svh;
  padding: 88px 24px;
}
.visualization-share-object {
  visibility: hidden;
  inline-size: min(100%, 780px);
  min-inline-size: 0;
  perspective: 1600px;
}
.visualization-share-ready .visualization-share-object {
  visibility: visible;
}
.visualization-share-card {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  transform-style: preserve-3d;
  transition: transform 0.65s cubic-bezier(0.22, 0.75, 0.22, 1);
}
.visualization-share-flipped {
  transform: rotateY(180deg);
}
.visualization-share-face {
  position: relative;
  grid-area: 1 / 1;
  display: flex;
  flex-direction: column;
  min-block-size: 0;
  min-inline-size: 0;
  overflow: hidden;
  border: 0;
  border-radius: 36px;
  background: var(--share-surface);
  box-shadow:
    0 0 0 0.5px var(--share-outline),
    0 2px 5px var(--share-shadow-near),
    0 18px 60px -25px var(--share-shadow-far);
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
}
.visualization-share-sources[hidden] {
  display: none;
}
.visualization-share-sources {
  transform: rotateY(180deg);
}
.visualization-share-content {
  flex: 1;
  padding: 36px;
}
.visualization-share-page iframe {
  display: block;
  inline-size: 100%;
  max-inline-size: none;
  margin: 0;
  border: 0;
}
.visualization-share-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 20px;
  padding: 16px 8px 0;
}
.visualization-share-attribution {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 5px;
  min-inline-size: 0;
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--share-credit);
  font-size: 13px;
  line-height: 1.5;
}
.visualization-share-growth,
.visualization-share-source-link {
  color: var(--share-link);
  text-decoration: none;
}
.visualization-share-growth {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
}
.visualization-share-logo {
  display: block;
  flex-shrink: 0;
  inline-size: 20px;
  block-size: 20px;
}
.visualization-share-growth:hover,
.visualization-share-source-link:hover {
  text-decoration: underline solid;
}
.visualization-share-controls {
  display: grid;
  margin-inline-start: auto;
}
.visualization-share-toggle {
  grid-area: 1 / 1;
  justify-self: end;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 8px 0;
  border: 0;
  background: none;
  color: var(--share-control);
  font: inherit;
  font-size: 14px;
  line-height: normal;
  white-space: nowrap;
  cursor: var(--cursor-interaction, pointer);
}
.visualization-share-toggle:hover {
  color: var(--foreground);
}
.visualization-share-toggle[hidden] {
  display: inline-flex;
  visibility: hidden;
}
.visualization-share-toggle:focus-visible,
.visualization-share-source summary:focus-visible,
.visualization-share-source-link:focus-visible,
.visualization-share-brand a:focus-visible,
.visualization-share-growth:focus-visible {
  outline: 2px solid var(--share-focus);
  outline-offset: 5px;
  border-radius: 3px;
}
.visualization-share-growth:focus-visible {
  outline-offset: 4px;
}
.visualization-share-icon {
  display: block;
  flex-shrink: 0;
  inline-size: 18px;
  block-size: 18px;
}
.visualization-share-sources-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-block-end: 20px;
}
.visualization-share-sources h2 {
  margin: 0;
  color: var(--foreground);
  font-size: 22px;
  line-height: 1.3;
  letter-spacing: -0.65px;
  font-weight: 600;
}
.visualization-share-source {
  border-block-start: 1px solid var(--share-divider);
  padding-block: 14px;
}
.visualization-share-source:last-child {
  padding-block-end: 0;
}
.visualization-share-source summary {
  display: flex;
  align-items: center;
  gap: 12px;
  list-style: none;
  cursor: var(--cursor-interaction, pointer);
}
.visualization-share-source summary::-webkit-details-marker {
  display: none;
}
.visualization-share-source-icon {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  inline-size: 32px;
  block-size: 32px;
  border: 1px solid var(--share-icon-border);
  border-radius: 7px;
  color: var(--share-icon);
}
.visualization-share-source-icon .visualization-share-icon {
  inline-size: 19px;
  block-size: 19px;
}
.visualization-share-chevron {
  flex-shrink: 0;
  inline-size: 16px;
  block-size: 16px;
  margin-inline-start: auto;
  color: var(--share-chevron);
  transition: transform 0.2s;
}
.visualization-share-source[open] .visualization-share-chevron {
  transform: rotate(90deg);
}
.visualization-share-source-heading {
  display: flex;
  flex-direction: column;
  min-inline-size: 0;
  overflow-wrap: anywhere;
}
.visualization-share-source-title {
  font-size: 14px;
  line-height: 1.4;
  font-weight: 500;
}
.visualization-share-source-context {
  margin-block-start: 3px;
  color: var(--share-context);
  font-size: 12px;
}
.visualization-share-source-description,
.visualization-share-source-link {
  margin: 12px 0 0 44px;
  font-size: 13px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.visualization-share-source-description {
  color: var(--share-description);
  white-space: pre-line;
}
.visualization-share-source-link {
  display: inline-block;
}
@media (width <= 540px) {
  .visualization-share-main {
    padding: 80px 16px 48px;
  }
  .visualization-share-brand {
    inset-block-start: 24px;
    inset-inline-start: 24px;
  }
  .visualization-share-wordmark {
    inline-size: 78px;
  }
  .visualization-share-face {
    border-radius: 30px;
  }
  .visualization-share-sources h2 {
    font-size: 20px;
  }
  .visualization-share-source-title {
    font-size: 13px;
  }
  .visualization-share-footer {
    padding: 14px 4px 0;
    gap: 8px 16px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .visualization-share-card,
  .visualization-share-chevron {
    transition: none;
  }
}
`})))()}function h(e,{locale:t,treatment:n=!1,styles:r=`:root {
  color-scheme: light dark;
  background-color: var(
    --background,
    var(--color-background-primary, light-dark(rgb(255 255 255), rgb(24 24 24)))
  ) !important;

  /* Agent-facing contract; keep in sync with SKILL.md. */
  --background: var(
    --color-background-primary,
    light-dark(rgb(255 255 255), rgb(24 24 24))
  );
  --foreground: var(
    --color-text-primary,
    light-dark(rgb(26 28 31), rgb(255 255 255))
  );
  --card: color-mix(in oklab, var(--foreground) 5%, var(--background));
  --card-foreground: var(
    --color-text-primary,
    light-dark(rgb(26 28 31), rgb(255 255 255))
  );
  --popover: var(
    --color-background-secondary,
    light-dark(rgb(255 255 255), rgb(45 45 45))
  );
  --popover-foreground: var(
    --color-text-primary,
    light-dark(rgb(26 28 31), rgb(255 255 255))
  );
  --primary: var(
    --color-text-info,
    light-dark(rgb(51 156 255), rgb(131 195 255))
  );
  --primary-foreground: var(
    --color-text-inverse,
    light-dark(rgb(255 255 255), rgb(13 13 13))
  );
  --secondary: var(
    --color-background-secondary,
    light-dark(rgb(255 255 255 / 96%), rgb(54 54 54 / 96%))
  );
  --secondary-foreground: var(
    --color-text-primary,
    light-dark(rgb(26 28 31), rgb(255 255 255))
  );
  --muted: color-mix(in srgb, var(--foreground) 10%, transparent);
  --muted-foreground: var(
    --color-text-secondary,
    light-dark(rgb(26 28 31 / 49.4%), rgb(255 255 255 / 49.8%))
  );
  --accent: var(
    --color-background-info,
    light-dark(rgb(229 242 255), rgb(13 39 63))
  );
  --accent-foreground: var(
    --color-text-info,
    light-dark(rgb(51 156 255), rgb(131 195 255))
  );
  --destructive: var(
    --color-text-warning,
    light-dark(rgb(226 85 7), rgb(255 133 73))
  );
  --border: var(
    --color-border-secondary,
    light-dark(rgb(26 28 31 / 8%), rgb(255 255 255 / 8.2%))
  );
  --input: var(
    --color-border-primary,
    light-dark(
      rgb(26 28 31 / 11.8%),
      color-mix(in oklab, rgb(0 0 0) 10%, transparent)
    )
  );
  --ring: var(
    --color-ring-primary,
    light-dark(rgb(51 156 255), rgb(131 195 255 / 76%))
  );
  --font-size-base: var(--font-text-md-size, 16px);
  --blue: light-dark(rgb(51 156 255), rgb(51 156 255));
  --orange: light-dark(rgb(226 85 7), rgb(251 106 34));
  --green: light-dark(rgb(0 162 64), rgb(64 201 119));
  --red: light-dark(rgb(224 46 42), rgb(255 103 100));
  --purple: light-dark(rgb(146 79 247), rgb(173 123 249));
  --yellow: light-dark(rgb(255 195 0), rgb(255 210 64));
  --viz-series-1: var(--primary);
  --viz-series-2: light-dark(rgb(243 136 59), rgb(245 154 86));
  --viz-series-3: light-dark(rgb(93 201 119), rgb(116 213 139));
  --viz-series-4: light-dark(rgb(235 119 177), rgb(240 143 192));
  --viz-series-5: light-dark(rgb(155 121 236), rgb(170 145 239));
  --viz-series-6: light-dark(rgb(58 185 177), rgb(90 203 194));

  /* Internal implementation variables; not part of the agent contract. */
  --font-sans:
    -apple-system-body, ui-sans-serif, -apple-system, system-ui, "Segoe UI",
    Helvetica, "Apple Color Emoji", Arial, sans-serif, "Segoe UI Emoji",
    "Segoe UI Symbol";
  --font-mono:
    ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono",
    monospace;
  --font-size-normal: max(11px, var(--font-size-base));
  --font-size-tooltip: calc(var(--font-size-base) - 1px);
  --font-size-small: max(11px, calc(var(--font-size-base) - 2px));
  --font-size-h1: calc(var(--font-size-normal) * 1.7142857143);
  --font-size-h2: calc(var(--font-size-normal) * 1.4285714286);
  --font-size-h3: calc(var(--font-size-normal) * 1.2857142857);
  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --icon-size: 16px;
  --line-height-normal: calc(var(--font-size-normal) * 1.5);
  --line-height-tooltip: calc(var(--font-size-tooltip) * 1.4285714286);
  --line-height-small: calc(var(--font-size-small) + 4px);
  --corner-shape: round;
  --radius: var(--border-radius-lg, 8px);
  --radius-sm: calc(var(--radius) * 0.5);
  --radius-md: calc(var(--radius) * 0.75);
  --radius-lg: var(--radius);
  --radius-2xl: calc(var(--radius) * 2);
  --radius-full: 9999px;
  --shadow-sm: 0 1px 2px -1px rgb(0 0 0 / 8%);
  --checkmark-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 17 17'%3E%3Cpath d='M12.8961 3.64101C13.1297 3.41418 13.4984 3.37523 13.7779 3.56581C14.0571 3.75635 14.1554 4.11331 14.0299 4.41347L13.9615 4.53847L7.71151 13.7045C7.59411 13.8767 7.4063 13.9877 7.19881 14.0072C6.99136 14.0267 6.78564 13.9533 6.63826 13.806L2.88826 10.056L2.79842 9.9457C2.6192 9.67407 2.64927 9.30496 2.88826 9.06581C3.12738 8.82669 3.49647 8.79676 3.76815 8.97597L3.8785 9.06581L7.03084 12.2182L12.8053 3.74941L12.8961 3.64101Z'/%3E%3C/svg%3E");

  /* Legacy aliases; not part of the current agent contract. */
  --viz-bg: transparent;
  --viz-panel: var(--card);
  --viz-border: var(--border);
  --viz-text: var(--foreground);
  --viz-muted: var(--muted-foreground);
  --viz-accent: var(--primary);
  --viz-accent-text: var(--primary-foreground);
  --viz-accent-bg: var(--accent);
  --viz-font-size: var(--font-size-base);
  --viz-warning: var(--destructive);
}

:root[data-theme="light"] {
  color-scheme: light;
}

:root[data-theme="dark"] {
  color-scheme: dark;
}

* {
  box-sizing: border-box;
}

html > body {
  /* Preserve MCP aliases for older inline renderers without creating :root cycles. */
  --color-background-primary: var(
    --background,
    light-dark(rgb(255 255 255), rgb(24 24 24))
  );
  --color-text-primary: var(
    --foreground,
    light-dark(rgb(26 28 31), rgb(255 255 255))
  );
  --color-border-secondary: var(
    --border,
    light-dark(rgb(26 28 31 / 8%), rgb(255 255 255 / 8.2%))
  );

  margin: 0;
  padding: var(--visualize-paint-gutter, 0px);
  color: var(--foreground);
  background: transparent !important;
  font-family: var(--font-sans) !important;
  -webkit-font-smoothing: antialiased;
  font-size: var(--font-size-base);
  line-height: calc(var(--font-size-base) * 1.625);
  font-weight: var(--font-weight-normal);
}

.cursor-interaction {
  cursor: var(--cursor-interaction, pointer);
}

a {
  color: color-mix(in srgb, var(--viz-accent) 80%, var(--viz-text) 20%);
  cursor: var(--cursor-interaction, pointer);
  text-decoration: none;
  text-underline-offset: 2px;
  font-weight: inherit;
}

a:is(:hover, :focus-visible) {
  text-decoration-line: underline;
  text-decoration-style: dashed;
  text-decoration-thickness: 0.5px;
}

h1,
h2,
h3,
h4,
h5,
h6,
p {
  margin-block: 0;
}
p,
h1,
h2,
h3,
h4,
h5,
h6,
li,
.table {
  font-family: var(--font-sans);
}

h1 {
  font-size: calc(var(--font-size-base) * 1.5);
  line-height: 1.3333333333;
}

h2 {
  font-size: calc(var(--font-size-base) * 1.25);
  line-height: 1.4;
}
h3 {
  font-size: calc(var(--font-size-base) * 1.125);
  line-height: 1.5555555556;
}
h4 {
  font-size: var(--font-size-base);
  line-height: 1.5;
}
h5,
h6 {
  font-size: var(--font-size-base);
  line-height: calc(var(--font-size-base) * 1.625);
}

h1,
h2,
h3,
h4,
h5,
h6,
b,
strong,
th {
  font-weight: 600;
}

code:not(pre code) {
  display: inline;
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  corner-shape: var(--corner-shape);
  background: var(--muted);
  font-family: var(--font-mono);
  font-size: 0.92em;
  overflow-wrap: anywhere;
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
  word-break: break-word;
}
pre,
pre code {
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 20px;
}

.table-responsive {
  width: 100%;
  overflow-x: auto;
  scrollbar-width: thin;
}

.table {
  width: 100%;
  color: var(--foreground);
  font: inherit;
  text-align: start;
  border-collapse: separate;
  border-spacing: 0;
  font-size: calc(var(--font-size-base) * 0.875);
  line-height: calc(var(--font-size-base) * 1.625);
  font-family: var(--font-sans);
}

.table :is(th, td) {
  padding-block: 10px;
  padding-inline: 0 24px;
  overflow-wrap: anywhere;
  border-bottom: 1px solid var(--border);
  text-align: start;
  vertical-align: top;
  border-bottom-color: color-mix(in srgb, var(--foreground) 5%, transparent);
}
.table :is(th, td):not(:last-child) {
  padding-inline-end: calc(var(--font-size-base) * 1.5);
}

.table-responsive > .table :is(th, td) {
  overflow-wrap: break-word;
}

.table :is(th, td):last-child {
  padding-inline-end: 0;
}

.table :is(caption, thead th) {
  font-weight: 600;
}

.table thead :is(th, td) {
  border-bottom-color: var(--border-strong, var(--input));
  padding-block: calc(var(--font-size-base) / 2);
  line-height: var(--font-size-base);
}

.table tbody tr:last-child :is(th, td) {
  border-bottom: 0;
}
.table tbody :is(th, td) {
  padding-block: calc(var(--font-size-base) * 0.625);
}

.table.table-sm :is(th, td) {
  padding-block: 8px;
}

.table.table-sm :is(th, td):not(:last-child) {
  padding-inline-end: 16px;
}

.table :is(.text-end, [align="right"]) {
  text-align: end;
  font-variant-numeric: tabular-nums;
}

.table :is(.text-center, [align="center"]) {
  text-align: center;
}

.table .text-nowrap {
  white-space: nowrap;
}

#widget {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  padding: 0;
  background: transparent !important;
}

.card {
  min-width: 0;
  padding: 12px;
  overflow: hidden;
  overflow-wrap: break-word;
  border-radius: var(--radius-2xl);
  corner-shape: var(--corner-shape);
  color: var(--card-foreground);
  background: var(--card);
}

.widget {
  min-width: 0;
  overflow: hidden;
  border: 0;
  border-radius: var(--radius-lg);
  corner-shape: var(--corner-shape);
  box-shadow: 0 0 0 0.5px var(--border-strong, var(--border));
  color: var(--foreground);
  background: var(--background);
}

#widget > :not(.card, .widget, .progress) {
  width: 100% !important;
  max-width: none !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
}

.tooltip {
  position: fixed;
  z-index: 50;
  top: 0;
  left: 0;
  width: max-content;
  max-width: min(
    20rem,
    var(--tooltip-available-width, calc(100vw - 10px)),
    calc(100vw - 10px)
  );
  max-height: min(
    var(--tooltip-available-height, calc(100vh - 10px)),
    calc(100vh - 10px)
  );
  border: 1px solid var(--border);
  corner-shape: var(--corner-shape);
  overflow-wrap: break-word;
  white-space: normal;
  pointer-events: none;
  user-select: none;
  font-family: var(--font-sans);
  padding: 5px 12px;
  border-color: color-mix(
    in oklab,
    light-dark(var(--primary-foreground), var(--foreground)) 5%,
    transparent
  );
  border-radius: var(--radius-2xl);
  color: light-dark(var(--primary-foreground), var(--foreground));
  background: light-dark(var(--foreground), var(--popover));
  box-shadow: 0 8px 18px rgb(15 23 42 / 20%);
  letter-spacing: -0.15px;
  font-size: calc(var(--font-size-base) * 14 / 16);
  font-size: round(nearest, calc(var(--font-size-base) * 14 / 16), 1px);
  font-weight: 600;
  line-height: 18px;
  text-align: center;
}

.viz-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(max(180px, 24%), 1fr));
  gap: 10px;
}

.viz-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.viz-stat-value {
  font-size: var(--font-size-h2);
  font-weight: var(--font-weight-medium);
  line-height: 1.25;
}

.viz-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

hr {
  width: 100%;
  height: 1px;
  margin-block: 6px;
  border: 0;
  background: var(--border);
}

.nav {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 4px;
}

.progress {
  display: flex;
  height: 8px;
  margin-block: calc((var(--line-height-normal, 1.5em) - 8px) / 2);
  overflow: hidden;
  border: 0;
  border-radius: var(--radius-full);
  background: var(--muted);
}

.progress-bar:only-child {
  border-radius: var(--radius-full);
}

.progress-bar {
  height: 100%;
  flex-shrink: 0;
  border: 0;
  background: var(--viz-series-1);
}

.viz-badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  color: color-mix(in srgb, var(--foreground) 40%, var(--muted-foreground));
  background: color-mix(in srgb, var(--foreground) 5%, transparent);
  font-family: var(--font-sans);
  font-size: calc(var(--font-size-base) * 14 / 16);
  font-size: round(nearest, calc(var(--font-size-base) * 14 / 16), 1px);
  font-weight: var(--font-weight-normal);
  line-height: 1;
}

small,
.text-small {
  font-size: var(--font-size-small);
  line-height: var(--line-height-small);
}

.text-muted {
  color: var(--muted-foreground);
}

.tabular-nums {
  font-variant-numeric: tabular-nums;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.viz-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.viz-controls > .form-label {
  display: grid;
  min-width: min(100%, 260px);
  flex: 1 1 280px;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: baseline;
  gap: 2px 12px;
  margin-bottom: 0;
}

.viz-controls > .form-label > :is(.form-control, .form-range, .form-select) {
  grid-column: 1 / -1;
}

.btn,
.nav-link,
.form-check-input,
.form-control,
.form-range,
.form-select {
  font: inherit;
}

/* Match inline alignment without overriding a containing flex or grid layout. */
.btn,
.nav-link,
.form-control,
.form-select,
.form-range,
.form-check {
  vertical-align: middle;
}

.btn,
.nav-link {
  appearance: button;
  display: inline-flex;
  inline-size: fit-content;
  max-inline-size: 100%;
  align-items: center;
  justify-content: center;
  gap: 4px;
  margin: 0;
  padding: 0 8px;
  -webkit-app-region: no-drag;
  border: 1px solid var(--input);
  corner-shape: var(--corner-shape);
  cursor: var(--cursor-interaction, pointer);
  text-align: center;
  text-decoration: none;
  white-space: nowrap;
  user-select: none;
  -webkit-font-smoothing: inherit;
  font-family: var(--font-sans);
  height: fit-content;
  min-height: calc(12px + 2 * var(--control-spacing, 12px));
  padding-inline: var(--control-spacing, 12px);
  border-color: transparent;
  border-radius: var(--radius-full);
  color: var(--foreground);
  background: color-mix(in srgb, var(--foreground) 5%, transparent);
  font-size: calc(var(--font-size-base) * 14 / 16);
  font-size: round(nearest, calc(var(--font-size-base) * 14 / 16), 1px);
  font-weight: var(--font-weight-normal);
  line-height: 18px;
}

.btn {
  border-color: var(--border);
  color: var(--secondary-foreground);
  background: var(--secondary);
}

.btn:is(.btn-block, .viz-tile) {
  inline-size: 100%;
}

.btn.viz-tile {
  min-width: 0;
  overflow-wrap: anywhere;
  white-space: normal;
}

a.btn {
  cursor: var(--cursor-interaction, pointer);
  text-decoration: none;
}

.btn:not(:disabled):hover {
  background: light-dark(
    color-mix(in srgb, var(--foreground) 5.5%, transparent),
    color-mix(in srgb, var(--foreground) 8%, transparent)
  );
}

.nav-link:not(:disabled):not([aria-disabled="true"]):hover {
  background: color-mix(in srgb, var(--foreground) 10%, transparent);
}

.btn-primary {
  border-color: var(--border);
  color: var(--primary-foreground);
  background: var(--foreground);
  background-clip: border-box;
}

.btn-primary .text-muted {
  color: color-mix(in srgb, var(--primary-foreground) 50%, transparent);
}

.btn-primary:not(:disabled):hover {
  background: color-mix(in srgb, var(--foreground) 80%, transparent);
  background-clip: border-box;
}

.btn-ghost {
  border-color: transparent;
  color: var(--muted-foreground);
  background: transparent;
}

.btn-ghost:not(:disabled):hover {
  color: var(--muted-foreground);
  background: light-dark(
    color-mix(in srgb, var(--foreground) 5.5%, transparent),
    color-mix(in srgb, var(--foreground) 8%, transparent)
  );
}

.nav-pills .nav-link {
  min-width: 0;
  border-color: transparent;
  color: var(--muted-foreground);
  background: transparent;
}

.nav-justified .nav-link {
  flex: 1 1 0;
  overflow-wrap: anywhere;
  white-space: normal;
}

.nav-pills .nav-link.active {
  color: var(--foreground);
  background: var(--muted);
}

/* Shared preview chrome; product styles stay inside each variant. */
.viz-dotted-background {
  background-image: radial-gradient(
    circle,
    color-mix(in srgb, var(--foreground) 14%, transparent) 0.8px,
    transparent 0.8px
  );
  background-position: center;
  background-size: 16px 16px;
}

.viz-carousel {
  position: relative;
  min-width: 0;
}

.viz-carousel:has(> .viz-carousel-controls) {
  min-height: calc(60px + var(--viz-carousel-picker-height, 0px));
  padding-bottom: 60px;
}

.viz-carousel > [data-variant][hidden] {
  display: none !important;
}

.viz-carousel > [data-variant] {
  isolation: isolate;
}

.viz-carousel-controls {
  --viz-carousel-hover: light-dark(
    color-mix(in srgb, var(--foreground) 5.4%, transparent),
    color-mix(in srgb, var(--foreground) 7.8%, transparent)
  );
  position: absolute;
  z-index: 2;
  bottom: 8px;
  left: 50%;
  display: flex;
  width: max-content;
  /* Leave room for the host's design-controls launcher at the trailing edge. */
  max-width: calc(100% - 96px);
  align-items: center;
  gap: 0;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 16px;
  color: var(--foreground);
  background: var(--background);
  font-family: var(--font-sans);
  /* Match the settings dropdown chrome independently of the content font size. */
  font-size: 13px;
  font-weight: var(--font-weight-normal);
  line-height: 18px;
  transform: translateX(-50%);
  user-select: none;
}

/* Keep authored mockup button styles out of the shared carousel chrome. */
.viz-carousel-controls button,
.viz-carousel-picker > summary {
  display: flex !important;
  height: auto !important;
  min-height: 30px;
  align-items: center !important;
  justify-content: center !important;
  gap: 4px;
  padding: 0 6px !important;
  -webkit-app-region: no-drag;
  border: 0 !important;
  border-radius: 14px !important;
  color: inherit !important;
  background: transparent !important;
  font: inherit !important;
  -webkit-tap-highlight-color: transparent;
}

.viz-carousel-controls > button,
.viz-carousel-picker > summary {
  position: relative;
  isolation: isolate;
}

.viz-carousel-controls > button {
  --icon-size: 16px;
  width: 30px !important;
  padding: 0 !important;
}

.viz-carousel-picker > summary {
  padding-inline: 12px !important;
}

.viz-carousel-controls .viz-carousel-caret {
  width: 14px;
  height: 14px;
  flex: none;
  margin: 0;
  color: inherit;
  transform: rotate(180deg);
}

.viz-carousel-controls > button > svg,
.viz-carousel-controls .viz-carousel-caret,
.viz-carousel-count {
  opacity: 0.5;
}

.viz-carousel-controls > button::before,
.viz-carousel-picker > summary::before {
  position: absolute;
  z-index: -1;
  inset: 3px;
  border-radius: 12px;
  content: "";
  pointer-events: none;
}

.viz-carousel-controls > button:hover::before,
.viz-carousel-picker > summary:hover::before {
  background: var(--viz-carousel-hover);
}

.viz-carousel-controls > button,
.viz-carousel-controls [data-lucide],
.viz-carousel-controls .lucide {
  flex-shrink: 0;
}

.viz-carousel-picker {
  min-width: 0;
}

.viz-carousel-picker > summary {
  min-width: 0;
  list-style: none;
}

.viz-carousel-picker > summary::-webkit-details-marker {
  display: none;
}

.viz-carousel-count {
  flex-shrink: 0;
  white-space: nowrap;
}

.viz-carousel-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.viz-carousel-options {
  position: absolute;
  right: 0;
  bottom: calc(100% + 4px);
  left: 0;
  display: flex;
  max-height: 240px;
  flex-direction: column;
  gap: 2px;
  overflow: auto;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--background);
  box-shadow: 0 4px 12px light-dark(rgb(0 0 0 / 6%), rgb(0 0 0 / 25%));
}

.viz-carousel-options > button {
  border-radius: max(0px, calc(var(--radius-lg) - 5px)) !important;
  width: 100% !important;
  min-height: 28px;
  justify-content: flex-start !important;
  padding: 4px 8px !important;
  font-size: var(--font-size-small) !important;
  text-align: start;
  white-space: normal;
  overflow-wrap: anywhere;
}

.viz-carousel-options > [aria-current="true"],
.viz-carousel-options > button:hover {
  background: var(--viz-carousel-hover) !important;
}

.btn:disabled,
.nav-link:disabled,
.nav-link[aria-disabled="true"] {
  cursor: not-allowed;
  opacity: 0.4;
}

[data-lucide] {
  stroke-width: 1.6;
}

.form-label {
  display: block;
  margin-bottom: 6px;
  color: var(--foreground);
}

.form-control {
  display: block;
  width: 100%;
  padding: 0 8px;
  outline: none;
  border: 1px solid var(--input);
  corner-shape: var(--corner-shape);
  color: var(--foreground);
  font-family: var(--font-sans);
  height: calc(12px + 2 * var(--control-spacing, 12px));
  min-height: calc(12px + 2 * var(--control-spacing, 12px));
  padding-inline: calc(4px + var(--control-spacing, 12px) / 2);
  border-color: var(--input);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--popover) 96%, transparent);
  font-size: calc(var(--font-size-base) * 14 / 16);
  font-size: round(nearest, calc(var(--font-size-base) * 14 / 16), 1px);
  font-weight: var(--font-weight-normal);
  line-height: 1.4285714286;
}
.form-control:is(
  [type="file"],
  [type="date"],
  [type="datetime-local"],
  [type="month"],
  [type="week"],
  [type="color"]
) {
  height: calc(12px + 2 * var(--control-spacing, 12px));
  min-height: calc(12px + 2 * var(--control-spacing, 12px));
  line-height: 18px;
}
.form-control:is(
  [type="date"],
  [type="datetime-local"],
  [type="month"],
  [type="week"]
) {
  padding-inline: var(--control-spacing, 12px);
}

.form-control::placeholder {
  color: var(--muted-foreground);
}

.form-control[type="file"] {
  overflow: hidden;
  cursor: var(--cursor-interaction, pointer);
  padding: 0;
}

.form-control[type="file"]::file-selector-button {
  padding: 0 8px;
  border: 0;
  border-right: 1px solid var(--input);
  color: var(--secondary-foreground);
  background: var(--secondary);
  cursor: inherit;
  font: inherit;
  min-height: calc(10px + 2 * var(--control-spacing, 12px));
  padding-inline: var(--control-spacing, 12px);
  margin-inline-end: var(--control-spacing, 12px);
}

.form-control[type="file"]:not(:disabled):hover::file-selector-button {
  background: color-mix(in srgb, var(--foreground) 6%, var(--secondary));
}

.form-control-color[type="color"] {
  width: 40px;
  height: calc(12px + 2 * var(--control-spacing, 12px));
  padding: 3px;
  cursor: var(--cursor-interaction, pointer);
}

.form-control-color[type="color"]::-webkit-color-swatch-wrapper {
  padding: 0;
}

.form-control-color[type="color"]::-webkit-color-swatch {
  border: 0;
  border-radius: calc(var(--radius-lg) - 4px);
  corner-shape: var(--corner-shape);
}

textarea.form-control {
  height: auto;
  resize: vertical;
  min-height: 96px;
  padding: 8px 10px;
}

.form-control:focus-visible {
  border-color: var(--ring);
  box-shadow: none;
}
.form-control:disabled {
  color: var(--muted-foreground);
  background: color-mix(in srgb, var(--foreground) 5%, transparent);
  opacity: 1;
}
.form-control[aria-invalid="true"] {
  border-color: var(--red);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--red) 20%, transparent);
}

.form-control:disabled,
.form-select:disabled {
  cursor: not-allowed;
}

.form-select {
  appearance: none;
  display: block;
  width: 100%;
  height: fit-content;
  min-height: calc(12px + 2 * var(--control-spacing, 12px));
  margin: 0;
  /* The secondary icon role is 14px at compact density and 16px at web density. */
  --icon-size: calc(10px + var(--control-spacing, 12px) / 2);
  /* Settings dropdowns retain a 12px inset and a 4px text-to-chevron gap. */
  padding: 0 calc(16px + var(--icon-size)) 0 12px;
  outline: none;
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  corner-shape: var(--corner-shape);
  color: var(--foreground);
  background-color: var(--secondary);
  background-image:
    linear-gradient(
      45deg,
      transparent calc(50% - 0.6px),
      var(--muted-foreground) calc(50% - 0.6px) calc(50% + 0.6px),
      transparent calc(50% + 0.6px)
    ),
    linear-gradient(
      135deg,
      transparent calc(50% - 0.6px),
      var(--muted-foreground) calc(50% - 0.6px) calc(50% + 0.6px),
      transparent calc(50% + 0.6px)
    );
  background-position:
    calc(100% - 12px - var(--icon-size) / 2) 50%,
    calc(100% - 12px - var(--icon-size) * 0.18) 50%;
  background-repeat: no-repeat;
  background-size: calc(var(--icon-size) * 0.32) calc(var(--icon-size) * 0.32);
  cursor: var(--cursor-interaction, default);
  font-size: calc(var(--font-size-base) * 14 / 16);
  font-size: round(nearest, calc(var(--font-size-base) * 14 / 16), 1px);
  font-weight: var(--font-weight-normal);
  line-height: 18px;
}

.form-select option {
  color: var(--popover-foreground);
  background-color: var(--popover);
}

.form-select:not(:disabled):hover {
  background-color: light-dark(
    color-mix(in srgb, var(--foreground) 5.5%, transparent),
    color-mix(in srgb, var(--foreground) 8%, transparent)
  );
}

.form-select:focus-visible {
  box-shadow: 0 0 0 2px var(--ring);
}
.form-select:disabled {
  opacity: 0.4;
}

.form-check {
  display: flex;
  min-height: calc(12px + 2 * var(--control-spacing, 12px));
  align-items: center;
  gap: 6px;
}

.form-check-input {
  appearance: none;
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  margin: 0;
  border: 1px solid var(--input);
  color: var(--primary-foreground);
  background-color: transparent;
  cursor: var(--cursor-interaction, default);
  transition:
    background-color 150ms,
    border-color 150ms,
    box-shadow 150ms;
}

.form-check:not(.form-switch) .form-check-input[type="checkbox"] {
  corner-shape: round;
  box-shadow: var(--shadow-sm);
  position: relative;
  width: calc(10px + var(--control-spacing, 12px) / 2);
  height: calc(10px + var(--control-spacing, 12px) / 2);
  border-color: var(--border-strong, var(--input));
  border-radius: calc(var(--radius-sm) / 2);
  background-color: transparent;
  color: var(--foreground);
}

.form-check:not(.form-switch)
  .form-check-input:not(:disabled):not(:checked):hover {
  background-color: var(--card);
}

.form-check:not(.form-switch)
  .form-check-input[type="checkbox"]:is(:checked, :indeterminate) {
  border-color: var(--border-strong, var(--input));
  background-color: color-mix(in srgb, var(--popover) 96%, transparent);
}

.form-check:not(.form-switch)
  .form-check-input[type="checkbox"]:checked::before {
  display: block;
  width: 100%;
  height: 100%;
  background: var(--primary-foreground);
  content: "";
  mask: var(--checkmark-image) center / 12px 12px no-repeat;
  background-color: var(--foreground);
}
.form-check:not(.form-switch)
  .form-check-input[type="checkbox"]:indeterminate::before {
  position: absolute;
  inset: 0;
  display: block;
  width: 65%;
  height: 6.65%;
  margin: auto;
  border-radius: var(--radius-full);
  background: var(--foreground);
  mask: none;
  content: "";
}

.form-check-input[type="radio"] {
  border-radius: var(--radius-full);
  width: 16px;
  height: 16px;
  border: 0;
  box-shadow: inset 0 0 0 1px var(--input);
}

.form-check-input[type="radio"]:checked {
  border: 0;
  background: radial-gradient(
    circle,
    var(--primary-foreground) 0 3px,
    var(--foreground) 3px
  );
  box-shadow: none;
}

.form-check:not(.form-switch) .form-check-input:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}
.form-check:not(.form-switch) .form-check-input[type="checkbox"]:focus-visible {
  border-color: var(--ring);
  outline: none;
  box-shadow: 0 0 0 2px var(--ring);
}

.form-check:not(.form-switch) .form-check-input:disabled {
  cursor: not-allowed;
  pointer-events: none;
}

.form-check:not(.form-switch) .form-check-input:disabled + .form-check-label {
  cursor: not-allowed;
}
.form-check:not(.form-switch) .form-check-input[type="radio"]:disabled,
.form-check:not(.form-switch)
  .form-check-input[type="radio"]:disabled
  + .form-check-label {
  opacity: 0.5;
}

.form-switch .form-check-input:disabled,
.form-switch .form-check-input:disabled + .form-check-label {
  cursor: not-allowed;
  opacity: 0.6;
}

.form-check-label {
  color: var(--foreground);
  cursor: var(--cursor-interaction, default);
}

.form-switch .form-check-input {
  position: relative;
  width: 32px;
  height: 20px;
  border: 0;
  border-radius: var(--radius-full);
  background: var(--muted);
  box-shadow: none;
  transition: background-color 200ms cubic-bezier(0, 0, 0.2, 1);
}

.form-switch .form-check-input::before {
  position: absolute;
  top: 50%;
  left: 0;
  width: 16px;
  height: 16px;
  box-sizing: border-box;
  border: 1px solid light-dark(var(--primary-foreground), var(--foreground));
  border-radius: var(--radius-full);
  box-shadow: var(--shadow-sm);
  content: "";
  transform: translate(2px, -50%);
  transition: transform 200ms cubic-bezier(0, 0, 0.2, 1);
  border-color: #fff;
  background: #fff;
}

.form-switch .form-check-input:checked {
  background: var(--blue);
}

.form-switch .form-check-input:checked::before {
  transform: translate(14px, -50%);
}

.form-switch .form-check-input:focus-visible {
  box-shadow: 0 0 0 2px var(--ring);
  outline: none;
}

.form-range {
  appearance: none;
  display: block;
  width: 100%;
  flex: 1;
  margin: 0;
  padding: 0;
  border: 0;
  accent-color: var(--primary);
  height: calc(12px + 2 * var(--control-spacing, 12px));
  min-height: calc(12px + 2 * var(--control-spacing, 12px));
  outline: none;
  border-radius: var(--radius-full);
  color: var(--foreground);
  background: transparent;
}

.form-range::-webkit-slider-runnable-track {
  background: var(--form-range-track, var(--border));
  height: 2px;
  border-radius: var(--radius-full);
}

.form-range::-webkit-slider-thumb {
  appearance: none;
  width: 20px;
  height: 20px;
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  margin-top: -9px;
  border-color: transparent;
  background: currentColor;
  box-shadow: var(--shadow-sm);
}

/* Outline the native track and thumb, preserving the larger input hit area. */
.form-range:focus-visible::-webkit-slider-runnable-track {
  outline: 2px auto Highlight;
  outline-color: -webkit-focus-ring-color;
}

.form-range::-moz-range-track {
  background: var(--form-range-track, var(--border));
  height: 2px;
  border-radius: var(--radius-full);
}

.form-range::-moz-range-thumb {
  width: 20px;
  height: 20px;
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  border-color: transparent;
  background: currentColor;
  box-shadow: var(--shadow-sm);
}

.form-range:focus-visible::-moz-range-thumb {
  outline: 2px solid Highlight;
  outline-offset: 2px;
}

.form-range:disabled {
  opacity: 1;
  cursor: default;
}

.btn:not(.btn-primary, .viz-tile):is(
  [aria-pressed="true"],
  [aria-selected="true"],
  .is-selected
) {
  border-color: transparent;
  color: var(--primary-foreground);
  background: var(--blue);
}

.btn.viz-tile:is([aria-pressed="true"], [aria-selected="true"], .is-selected) {
  border-color: var(--primary);
  box-shadow: inset 0 0 0 1px var(--primary);
}

.btn:focus-visible,
.nav-link:focus-visible {
  outline-offset: 2px;
  outline: none;
  box-shadow: 0 0 0 2px var(--ring);
}

.viz-carousel-controls :is(button, summary):focus-visible {
  outline: 2px solid var(--ring) !important;
  outline-offset: 2px !important;
}

/* Web recipes are the default, including on renderers without inline style queries. */
@supports (border-radius: if(style(--corner-shape: round): 1px; else: 2px)) {
  /* Match the host's proportional text-sm scale at every text preference. */
  .tooltip,
  .viz-badge,
  .btn,
  .nav-link,
  .form-control,
  .form-select {
    font-size: if(
      style(--corner-shape: round): round(
          nearest,
          calc(var(--font-size-base) * 14 / 16),
          1px
        );
        else: round(nearest, calc(var(--font-size-base) * 13 / 14), 1px)
    );
  }

  .btn,
  .nav-link,
  .form-select {
    border-radius: if(
      style(--corner-shape: round): var(--radius-full); else: var(--radius-lg)
    );
  }

  .form-check:not(.form-switch) .form-check-input[type="checkbox"] {
    border-radius: if(
      style(--corner-shape: round): calc(var(--radius-sm) / 2);
        else: calc(var(--radius-lg) * 0.4)
    );
  }

  .tooltip {
    font-weight: if(
      style(--corner-shape: round): 600; else: var(--font-weight-normal)
    );
  }
}

@media (pointer: coarse) {
  .viz-carousel:has(> .viz-carousel-controls) {
    min-height: calc(76px + var(--viz-carousel-picker-height, 0px));
    padding-bottom: 76px;
  }

  .btn,
  .nav-link,
  .viz-carousel-controls button,
  .viz-carousel-picker > summary,
  .form-control,
  .form-select {
    min-width: 44px;
    min-height: 44px;
  }

  /* Keep small-screen WebKit from zooming when a text field receives focus. */
  .form-control,
  .form-select {
    font-size: max(16px, calc(var(--font-size-base) * 14 / 16));
    font-size: max(
      16px,
      round(nearest, calc(var(--font-size-base) * 14 / 16), 1px)
    );
  }
  .form-control:is(
    [type="file"],
    [type="date"],
    [type="datetime-local"],
    [type="month"],
    [type="week"],
    [type="time"],
    [type="color"]
  ) {
    height: 44px;
    min-height: 44px;
    font-size: max(16px, calc(var(--font-size-base) * 14 / 16));
    font-size: max(
      16px,
      round(nearest, calc(var(--font-size-base) * 14 / 16), 1px)
    );
  }

  .form-control[type="file"]::file-selector-button {
    min-width: 44px;
    min-height: 44px;
  }

  .form-control-color[type="color"] {
    width: 44px;
    height: 44px;
  }

  .form-control:is(
    [type="date"],
    [type="datetime-local"],
    [type="month"],
    [type="time"],
    [type="week"]
  ) {
    min-width: 0;
    max-width: 100%;
    padding-block: 8px;
  }

  .form-check {
    min-height: 44px;
    padding-inline: 15px;
  }

  .form-check-input {
    position: relative;
  }

  .form-check-input::after {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 44px;
    height: 44px;
    content: "";
    transform: translate(-50%, -50%);
  }

  .form-check-label {
    display: inline-flex;
    min-width: 44px;
    min-height: 44px;
    align-items: center;
  }

  .form-range {
    height: 44px;
    touch-action: pan-y;
  }
}

svg {
  display: block;
  max-width: 100%;
  height: auto;
}

#widget > svg {
  width: 100%;
}

/* Model-authored chart rules can otherwise stretch icons after these styles load. */
svg.lucide {
  display: block;
  width: var(--icon-size) !important;
  height: var(--icon-size) !important;
  flex: none;
  margin: 0 !important;
  stroke-width: 1.6;
}

.text-warning,
.text-destructive {
  color: var(--destructive);
}
`,title:a,share:c}){let u=`<!doctype html>
<html lang="${g(t)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="${v}">
<title>${g(a)}</title>
</head>
<body>
<script type="application/json" id="codex-visualization-widget-state">__CODEX_VISUALIZATION_WIDGET_STATE__<\/script>
<script>${l.replaceAll(`<\/script`,`<\\/script`)}<\/script>
${o(e,{treatment:n,lockDocumentOverflow:!1,reportToHost:!1,styles:`${r}\nhtml>body{padding:0}`})}
</body>
</html>
`,f=`<iframe id="codex-visualization" sandbox="allow-scripts" scrolling="no" referrerpolicy="no-referrer" title="${g(a)}" data-srcdoc="${g(u)}"></iframe>`;return`<!doctype html>
<html lang="${g(t)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="${y}">
<title>${g(a)}</title>
<style>:root{color-scheme:light dark;background:${i}}html,body{margin:0}body{box-sizing:border-box;padding:1rem;background:inherit}iframe{display:block;width:100%;max-width:736px;height:calc(100vh - 2rem);margin:0 auto;border:0}</style>
${c==null?``:`<style>${r}\n${p}</style>`}
</head>
<body>
${f}
${c==null?``:`<script type="application/json" id="visualization-share">${JSON.stringify(c).replaceAll(`<`,`\\u003c`)}<\/script>
<script>${s.replaceAll(`<\/script`,`<\\/script`)}<\/script>`}
<script>${d.replaceAll(`<\/script`,`<\\/script`)}<\/script>
</body>
</html>
`}function g(e){return e.replaceAll(`&`,`&amp;`).replaceAll(`<`,`&lt;`).replaceAll(`>`,`&gt;`).replaceAll(`"`,`&quot;`)}var _,v,y;function b(){return(b=e((()=>{c(),u(),f(),n(),a(),r(),m(),_=t.resourceDomains.join(` `),v=[`default-src 'none'`,`script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' ${_}`,`style-src 'unsafe-inline' ${_}`,`img-src ${_}`,`font-src ${_}`,`media-src ${_}`,`worker-src blob:`,`connect-src blob: data:`,`frame-src 'none'`,`object-src 'none'`,`base-uri 'none'`,`form-action 'none'`].join(`; `),y=v.replace(`frame-src 'none'`,`frame-src 'self'`)})))()}b();export{h as getStandaloneVisualizationHtml};
//# sourceMappingURL=visualization-standalone-document-1db155a3ec82.js.map