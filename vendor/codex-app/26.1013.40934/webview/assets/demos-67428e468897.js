import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";var t;function n(){return(n=e((()=>{t=`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <style>
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        background: var(--background, #fafaf8);
        color: var(--foreground, #272727);
        font:
          14px system-ui,
          sans-serif;
      }
      main {
        color: var(--foreground, #272727);
        font:
          14px system-ui,
          sans-serif;
        background: var(--background, #fafaf8);
        border: 1px solid var(--border, #d4d4d0);
        padding: 22px;
      }
      header {
        display: flex;
        align-items: center;
        gap: 16px;
        flex-wrap: wrap;
        margin-bottom: 20px;
      }
      h1 {
        color: inherit;
        font-size: 18px;
        font-weight: 650;
        margin: 0;
        margin-right: auto;
      }
      .octave {
        display: flex;
        gap: 9px;
        align-items: center;
      }
      button {
        font: inherit;
        cursor: pointer;
      }
      header button {
        color: inherit;
        background: transparent;
        border: 1px solid var(--border, #c6c6c0);
        width: 32px;
        height: 32px;
      }
      .volume {
        font-size: 11px;
        text-transform: uppercase;
        display: flex;
        align-items: center;
        gap: 9px;
      }
      input {
        width: 78px;
        accent-color: var(--primary, #50534e);
      }
      .keyboard {
        position: relative;
        display: flex;
        height: 215px;
        border: 1px solid #5c5e58;
        touch-action: none;
      }
      .key {
        border-radius: 0;
        border: 0;
        padding: 0;
        display: flex;
        align-items: flex-end;
        justify-content: center;
        user-select: none;
        touch-action: none;
      }
      .white {
        width: calc(100% / 14);
        height: 100%;
        background: white;
        border-right: 1px solid #d0d0cb;
        border-bottom: 5px solid #deded8;
        color: #888;
        padding-bottom: 18px;
      }
      .black {
        position: absolute;
        top: 0;
        width: 4.6%;
        height: 61%;
        background: #262825;
        color: #b6b8b1;
        border: 1px solid #141611;
        border-radius: 0 0 3px 3px;
        padding-bottom: 15px;
        z-index: 1;
      }
      .key.active {
        background: #e5e5df;
        color: #272727;
      }
      .black.active {
        background: #4b4e47;
        color: #b6b8b1;
      }
      footer {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
        font-size: 11px;
        color: var(--muted-foreground, #858880);
        margin-top: 12px;
      }
      #status::before {
        content: "";
        display: inline-block;
        width: 6px;
        height: 6px;
        margin-right: 6px;
        border-radius: 50%;
        background: var(--muted-foreground, #bfc1b9);
      }
      #status.playing::before {
        background: var(--primary, #50534e);
      }
      .keys {
        font-size: 11px;
      }
      button:focus-visible {
        outline: 3px solid var(--ring, #508cc0);
        outline-offset: -3px;
      }
      @media (max-width: 620px) {
        main {
          padding: 16px;
        }
        .keyboard {
          height: 170px;
        }
        .volume {
          width: 100%;
        }
        .volume input {
          flex: 1;
        }
        .key {
          font-size: 10px;
        }
        header {
          gap: 9px;
        }
      }
    </style>
  </head>
  <body>
    <!--labels-->
    <main>
      <header>
        <h1 data-text="pianoTitle"></h1>
        <div class="octave">
          <button id="down">−</button><output id="range"></output
          ><button id="up">+</button>
        </div>
        <label class="volume"
          ><span data-text="volume"></span
          ><input
            id="volume"
            type="range"
            min="0"
            max="1"
            step=".01"
            value=".65"
        /></label>
      </header>
      <div class="keyboard" id="keyboard" role="group"></div>
      <footer>
        <span id="status" role="status" data-text="audioHint"></span
        ><span class="keys" data-text="keyboardHint"></span>
      </footer>
    </main>
    <script>
      const el = (id) => document.getElementById(id);
      document
        .querySelectorAll("[data-text]")
        .forEach((e) => (e.textContent = text[e.dataset.text]));
      document.title = text.pianoTitle;
      el("down").setAttribute("aria-label", text.octaveDown);
      el("up").setAttribute("aria-label", text.octaveUp);
      el("keyboard").setAttribute("aria-label", text.pianoTitle);
      const mapping = [
        "a",
        "w",
        "s",
        "e",
        "d",
        "f",
        "t",
        "g",
        "y",
        "h",
        "u",
        "j",
        "k",
        "o",
        "l",
        "p",
        ";",
        "'",
        "]",
      ];
      const names = [
        "C",
        "C♯",
        "D",
        "D♯",
        "E",
        "F",
        "F♯",
        "G",
        "G♯",
        "A",
        "A♯",
        "B",
      ];
      let octave = 4,
        audio = null;
      const voices = new Map();
      const held = new Map();
      const keys = [];
      function stop(key) {
        held.delete(key);
        const voice = voices.get(key);
        if (!voice) return;
        voice.gain.gain.cancelScheduledValues(audio.currentTime);
        voice.gain.gain.setTargetAtTime(0, audio.currentTime, 0.025);
        voice.osc.stop(audio.currentTime + 0.15);
        voices.delete(key);
        el("status").classList.toggle("playing", voices.size > 0);
        keys[key].classList.remove("active");
        keys[key].setAttribute("aria-pressed", "false");
      }
      function stopAll() {
        Array.from(held.keys()).forEach(stop);
      }
      async function start(key) {
        if (held.has(key)) return;
        const press = {};
        held.set(key, press);
        try {
          audio ??= new AudioContext();
          if (audio.state !== "running") await audio.resume();
          if (held.get(key) !== press) return;
          const osc = audio.createOscillator(),
            gain = audio.createGain();
          osc.type = "triangle";
          osc.frequency.value =
            440 * 2 ** (((octave + 1) * 12 + key - 69) / 12);
          gain.gain.setValueAtTime(0, audio.currentTime);
          gain.gain.linearRampToValueAtTime(
            Number(el("volume").value) * 0.15,
            audio.currentTime + 0.01,
          );
          osc.connect(gain).connect(audio.destination);
          osc.start();
          osc.onended = () => {
            osc.disconnect();
            gain.disconnect();
          };
          voices.set(key, { osc, gain });
          el("status").classList.add("playing");
          keys[key].classList.add("active");
          keys[key].setAttribute("aria-pressed", "true");
          el("status").textContent = text.audioOn;
        } catch {
          held.delete(key);
          el("status").textContent = text.audioUnavailable;
        }
      }
      function labels() {
        keys.forEach((b, i) => {
          const note = names[i % 12] + (octave + Math.floor(i / 12));
          b.setAttribute("aria-label", note);
          b.textContent = b.classList.contains("black")
            ? (mapping[i] ?? "").toUpperCase()
            : note;
        });
        el("range").textContent = "C" + octave + "–B" + (octave + 1);
        el("down").disabled = octave === 2;
        el("up").disabled = octave === 6;
      }
      let whites = 0;
      for (let i = 0; i < 24; i++) {
        const black = [1, 3, 6, 8, 10].includes(i % 12),
          b = document.createElement("button");
        b.className = "key " + (black ? "black" : "white");
        b.setAttribute("aria-pressed", "false");
        if (black) b.style.left = (whites / 14) * 100 - 2.3 + "%";
        else whites++;
        b.onpointerdown = (e) => {
          e.preventDefault();
          b.setPointerCapture(e.pointerId);
          start(i);
        };
        b.onpointerup = () => stop(i);
        b.onpointercancel = () => stop(i);
        b.onlostpointercapture = () => stop(i);
        b.onblur = () => stop(i);
        b.onkeydown = (e) => {
          if ((e.key === " " || e.key === "Enter") && !e.repeat) {
            e.preventDefault();
            start(i);
          }
        };
        b.onkeyup = (e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            stop(i);
          }
        };
        keys.push(b);
        el("keyboard").append(b);
      }
      el("down").onclick = () => {
        stopAll();
        octave = Math.max(2, octave - 1);
        labels();
      };
      el("up").onclick = () => {
        stopAll();
        octave = Math.min(6, octave + 1);
        labels();
      };
      el("volume").oninput = () =>
        voices.forEach((v) =>
          v.gain.gain.setTargetAtTime(
            Number(el("volume").value) * 0.15,
            audio.currentTime,
            0.01,
          ),
        );
      document.addEventListener("keydown", (e) => {
        if (
          e.target instanceof HTMLInputElement ||
          e.ctrlKey ||
          e.metaKey ||
          e.altKey
        )
          return;
        const i = mapping.indexOf(e.key.toLowerCase());
        if (i >= 0 && !e.repeat) {
          e.preventDefault();
          start(i);
        }
      });
      document.addEventListener("keyup", (e) => {
        const i = mapping.indexOf(e.key.toLowerCase());
        if (i >= 0) stop(i);
      });
      window.addEventListener("blur", stopAll);
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) stopAll();
      });
      labels();
    <\/script>
  </body>
</html>
`})))()}var r;function i(){return(i=e((()=>{r=`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <style>
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        color: var(--foreground, #242933);
        background: var(--background, #fff);
        font:
          14px system-ui,
          sans-serif;
      }
      main {
        padding: 16px;
        border: 1px solid var(--border, #e5e7eb);
        border-radius: var(--radius-2xl, 18px);
      }
      .layout {
        display: grid;
        grid-template-columns: 180px minmax(0, 1fr);
        gap: 24px;
      }
      .controls {
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding-right: 20px;
        border-right: 1px solid var(--border, #e5e7eb);
      }
      h1 {
        margin: 0;
        font-size: 16px;
        font-weight: 500;
      }
      label,
      .metric span,
      .balance span {
        display: block;
        margin-bottom: 6px;
        color: var(--muted-foreground, #777e89);
        font-size: 11px;
      }
      .field {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 6px 8px;
        border: 1px solid var(--border, #e5e7eb);
        border-radius: var(--radius-sm, 7px);
        background: var(--card, #f6f7f9);
      }
      input {
        width: 100%;
        min-width: 0;
        border: 0;
        background: transparent;
        color: inherit;
        font: inherit;
      }
      input:focus-visible {
        outline: 2px solid var(--ring, #437de8);
        outline-offset: 2px;
      }
      .pair,
      .actions,
      .metrics {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
      }
      button {
        padding: 6px 8px;
        border: 1px solid var(--border, #e5e7eb);
        border-radius: var(--radius-sm, 7px);
        background: var(--background, #fff);
        color: inherit;
        font: inherit;
        font-size: 11px;
        cursor: pointer;
      }
      button:hover {
        background: var(--card, #f6f7f9);
      }
      button:focus-visible {
        outline: 2px solid var(--ring, #437de8);
        outline-offset: 2px;
      }
      .balance output {
        font-size: 30px;
        font-weight: 550;
        letter-spacing: -0.03em;
      }
      .legend {
        display: flex;
        justify-content: flex-end;
        gap: 18px;
        margin-top: 16px;
        color: var(--muted-foreground, #777e89);
        font-size: 10px;
      }
      .legend span::before {
        content: "";
        display: inline-block;
        width: 6px;
        height: 6px;
        margin-right: 5px;
        border-radius: 50%;
        background: var(--green, #8cae7a);
      }
      .legend span + span::before {
        background: var(--blue, #437de8);
      }
      svg {
        display: block;
        width: 100%;
        height: auto;
        margin-top: 8px;
      }
      svg text {
        fill: var(--muted-foreground, #777e89);
        font-size: 11px;
      }
      .metrics {
        margin-top: 12px;
        padding-top: 12px;
        border-top: 1px solid var(--border, #e5e7eb);
      }
      .metric output {
        font-size: 16px;
        font-weight: 550;
      }
      .note {
        margin: 14px 0 0;
        color: var(--muted-foreground, #777e89);
        font-size: 10px;
        line-height: 1.5;
      }
      @media (max-width: 500px) {
        .layout {
          grid-template-columns: 1fr;
          gap: 20px;
        }
        .controls {
          padding-right: 0;
          padding-bottom: 20px;
          border-right: 0;
          border-bottom: 1px solid var(--border, #e5e7eb);
        }
      }
    </style>
  </head>
  <body>
    <!--labels-->
    <main>
      <div class="layout">
        <section class="controls">
          <h1 data-text="savingsTitle"></h1>
          <div>
            <label for="starting" data-text="starting"></label>
            <div class="field">
              <span>$</span
              ><input
                id="starting"
                type="number"
                min="0"
                max="10000000"
                step="100"
                value="10000"
              />
            </div>
          </div>
          <div>
            <label for="monthly" data-text="monthly"></label>
            <div class="field">
              <span>$</span
              ><input
                id="monthly"
                type="number"
                min="0"
                max="100000"
                step="50"
                value="1000"
              />
            </div>
          </div>
          <div class="pair">
            <div>
              <label for="rate" data-text="rate"></label>
              <div class="field">
                <input
                  id="rate"
                  type="number"
                  min="0"
                  max="12"
                  step="0.5"
                  value="7"
                /><span>%</span>
              </div>
            </div>
            <div>
              <label for="years" data-text="years"></label>
              <div class="field">
                <input id="years" type="number" min="1" max="40" value="20" />
              </div>
            </div>
          </div>
          <div class="actions">
            <button
              id="increase"
              type="button"
              data-text="increaseMonthly"
            ></button
            ><button id="reset" type="button" data-text="reset"></button>
          </div>
        </section>
        <section>
          <div class="balance">
            <span data-text="balance"></span><output id="balance"></output>
          </div>
          <div class="legend">
            <span data-text="contributions"></span
            ><span data-text="totalBalance"></span>
          </div>
          <svg viewBox="0 0 510 260" role="img" id="chart">
            <g id="grid"></g>
            <path
              id="deposits"
              fill="none"
              stroke="var(--green, #8cae7a)"
              stroke-width="2"
            />
            <path
              id="projection"
              fill="none"
              stroke="var(--blue, #437de8)"
              stroke-width="2.5"
            />
            <circle id="endpoint" r="4" fill="var(--blue, #437de8)" />
          </svg>
          <div class="metrics">
            <div class="metric">
              <span data-text="added"></span><output id="added"></output>
            </div>
            <div class="metric">
              <span data-text="growth"></span><output id="growth"></output>
            </div>
          </div>
        </section>
      </div>
      <p class="note" data-text="savingsNote"></p>
    </main>
    <script>
      const el = (id) => document.getElementById(id);
      document
        .querySelectorAll("[data-text]")
        .forEach((e) => (e.textContent = text[e.dataset.text]));
      document.title = text.savingsTitle;
      el("chart").setAttribute("aria-label", text.balance);
      const money = new Intl.NumberFormat(text.locale, {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      });
      const compact = new Intl.NumberFormat(text.locale, {
        style: "currency",
        currency: "USD",
        notation: "compact",
        maximumFractionDigits: 0,
      });
      const readNumber = (id, min, max) =>
        Math.max(min, Math.min(max, Number(el(id).value) || min));
      function draw() {
        const monthly = readNumber("monthly", 0, 100000),
          start = readNumber("starting", 0, 10000000),
          years = Math.round(readNumber("years", 1, 40)),
          rate = readNumber("rate", 0, 12) / 1200;
        let balance = start;
        const points = [[0, balance, start]];
        for (let m = 1; m <= years * 12; m++) {
          balance = balance * (1 + rate) + monthly;
          if (m % 12 === 0) points.push([m / 12, balance, start + monthly * m]);
        }
        const added = start + monthly * years * 12;
        el("balance").textContent = money.format(balance);
        el("added").textContent = money.format(added);
        el("growth").textContent = money.format(balance - added);
        const step = 10 ** Math.floor(Math.log10(Math.max(1, balance / 4))),
          top = Math.max(1, Math.ceil(balance / 4 / step)) * step * 4,
          x = (year) => 45 + (year / years) * 455,
          y = (value) => 230 - (value / top) * 210;
        const path = (column) =>
          points
            .map(
              (point, index) =>
                (index ? "L" : "M") + x(point[0]) + "," + y(point[column]),
            )
            .join(" ");
        el("projection").setAttribute("d", path(1));
        el("deposits").setAttribute("d", path(2));
        el("endpoint").setAttribute("cx", x(years));
        el("endpoint").setAttribute("cy", y(balance));
        el("grid").innerHTML = Array.from({ length: 5 }, (_, index) => {
          const value = (top * index) / 4;
          return (
            '<path d="M45,' +
            y(value) +
            ' H500" stroke="var(--border, #e5e7eb)"/><text x="4" y="' +
            (y(value) + 4) +
            '">' +
            compact.format(value) +
            '</text><text x="' +
            (45 + index * 113.75) +
            '" y="252" text-anchor="middle">' +
            Math.round((years * index) / 4) +
            "</text>"
          );
        }).join("");
      }
      ["starting", "monthly", "years", "rate"].forEach((id) => {
        const input = el(id);
        input.oninput = draw;
        input.onchange = () => {
          input.value = readNumber(id, Number(input.min), Number(input.max));
          if (id === "years") input.value = Math.round(Number(input.value));
          draw();
        };
      });
      el("increase").onclick = () => {
        el("monthly").value = Math.min(
          100000,
          readNumber("monthly", 0, 100000) + 250,
        );
        draw();
      };
      el("reset").onclick = () => {
        document
          .querySelectorAll("input")
          .forEach((input) => (input.value = input.defaultValue));
        draw();
      };
      draw();
    <\/script>
  </body>
</html>
`})))()}var a;function o(){return(o=e((()=>{a=`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <style>
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        color: var(--foreground, #242933);
        background: var(--background, #fff);
        font:
          14px system-ui,
          sans-serif;
      }
      main {
        border: 1px solid var(--border, #e5e7eb);
        border-radius: var(--radius-2xl, 18px);
        overflow: hidden;
      }
      .controls {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
        padding: 12px 16px;
        border-bottom: 1px solid var(--border, #e5e7eb);
      }
      button {
        border: 1px solid var(--border, #e5e7eb);
        border-radius: var(--radius-sm, 7px);
        padding: 6px 12px;
        color: inherit;
        background: var(--background, #fff);
        font: inherit;
        cursor: pointer;
      }
      button:hover {
        background: var(--card, #f6f7f9);
      }
      button:focus-visible,
      input:focus-visible {
        outline: 2px solid var(--ring, #437de8);
        outline-offset: 2px;
      }
      .speed {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
      }
      input {
        width: 100px;
        accent-color: var(--primary, #437de8);
      }
      #speed-value {
        min-width: 3em;
        font-variant-numeric: tabular-nums;
      }
      .layout {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 170px;
        gap: 16px;
        padding: 16px;
      }
      svg {
        display: block;
        width: 100%;
        height: 100%;
        min-height: 260px;
        background: #061426;
        border-radius: var(--radius-lg, 10px);
      }
      svg text {
        fill: #dbe6f7;
        font-size: 11px;
      }
      svg [role="button"] {
        cursor: pointer;
        outline: none;
      }
      svg [role="button"]:focus circle {
        stroke: #fff;
        stroke-width: 4;
      }
      .details {
        background: var(--card, #f6f7f9);
        border: 1px solid var(--border, #e5e7eb);
        border-radius: var(--radius-lg, 10px);
        padding: 16px;
      }
      .details p {
        margin: 0;
        color: var(--muted-foreground, #777e89);
        font-size: 11px;
      }
      .details .eyebrow {
        text-transform: uppercase;
        letter-spacing: 0.04em;
        font-size: 10px;
      }
      h1 {
        margin: 6px 0 4px;
        font-size: 22px;
        font-weight: 550;
      }
      dl {
        border-top: 1px solid var(--border, #e5e7eb);
        margin: 16px 0 0;
        padding-top: 16px;
      }
      dt {
        color: var(--muted-foreground, #777e89);
        font-size: 11px;
      }
      dd {
        margin: 4px 0 18px;
        font-size: 13px;
      }
      dd:last-child {
        margin-bottom: 0;
      }
      .note {
        margin: 0;
        padding: 0 16px 14px;
        color: var(--muted-foreground, #777e89);
        font-size: 10px;
        line-height: 1.5;
      }
      @media (max-width: 500px) {
        .layout {
          grid-template-columns: 1fr;
        }
        svg {
          min-height: 220px;
        }
        dl {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 4px 12px;
        }
        dt:nth-of-type(2) {
          grid-column: 2;
          grid-row: 1;
        }
        dd {
          margin: 0;
        }
        .controls {
          gap: 8px;
        }
      }
    </style>
  </head>
  <body>
    <!--labels-->
    <main>
      <div class="controls">
        <button id="play" type="button"></button>
        <label class="speed"
          ><span data-text="speed"></span
          ><input
            id="speed"
            type="range"
            min="0.5"
            max="5"
            step="0.5"
            value="3" /><output id="speed-value" for="speed"></output
        ></label>
        <button id="reset" type="button" data-text="reset"></button>
      </div>
      <div class="layout">
        <svg id="system" viewBox="0 0 680 360" role="group">
          <g id="orbits"></g>
          <circle cx="340" cy="180" r="27" fill="#ffcf69" opacity=".1" />
          <circle cx="340" cy="180" r="14" fill="#ffda7b" />
          <text x="340" y="210" text-anchor="middle" id="sun"></text>
          <g id="planets"></g>
        </svg>
        <section class="details" aria-live="polite">
          <p class="eyebrow" data-text="selectedBody"></p>
          <h1 id="name"></h1>
          <p id="kind"></p>
          <dl>
            <dt data-text="planetYear"></dt>
            <dd id="orbit"></dd>
            <dt data-text="distanceFromSun"></dt>
            <dd id="distance"></dd>
          </dl>
        </section>
      </div>
      <p class="note" data-text="solarNote"></p>
    </main>
    <script>
      const el = (id) => document.getElementById(id);
      document
        .querySelectorAll("[data-text]")
        .forEach((e) => (e.textContent = text[e.dataset.text]));
      document.title = text.solarTitle;
      el("system").setAttribute("aria-label", text.solarTitle);
      el("sun").textContent = text.sun;
      const planets = text.solarPlanets;
      let days = 0,
        selected = 5,
        playing = false,
        last = null,
        frame = null;
      const ns = "http://www.w3.org/2000/svg";
      function node(tag, attrs, parent) {
        const n = document.createElementNS(ns, tag);
        Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
        parent.append(n);
        return n;
      }
      const groups = planets.map((p, i) => {
        const radius = 40 + i * 36;
        node(
          "ellipse",
          {
            cx: 340,
            cy: 180,
            rx: radius,
            ry: radius * 0.45,
            fill: "none",
            stroke: "#41516c",
            "stroke-width": 1,
          },
          el("orbits"),
        );
        const group = node(
          "g",
          {
            role: "button",
            tabindex: 0,
            "aria-label": text[p[0]],
            "aria-pressed": i === selected,
          },
          el("planets"),
        );
        node("circle", { r: 17, fill: "transparent" }, group);
        if (i === 5)
          node(
            "ellipse",
            {
              rx: 15,
              ry: 5,
              fill: "none",
              stroke: "#efe5bd",
              transform: "rotate(-25)",
            },
            group,
          );
        node(
          "circle",
          { r: p[3], fill: p[4], stroke: "#eaf1fc", "stroke-width": 1.5 },
          group,
        );
        const label = node(
          "text",
          { y: -p[3] - 8, "text-anchor": "middle" },
          group,
        );
        label.textContent = text[p[0]];
        group.onclick = () => {
          selected = i;
          draw();
          updateDetails();
        };
        group.onkeydown = (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            selected = i;
            draw();
            updateDetails();
          }
        };
        return group;
      });
      function draw() {
        groups.forEach((g, i) => {
          const a = (days / planets[i][2]) * Math.PI * 2 + i * 0.93,
            r = 40 + i * 36;
          g.setAttribute(
            "transform",
            "translate(" +
              (340 + Math.cos(a) * r) +
              "," +
              (180 + Math.sin(a) * r * 0.45) +
              ")",
          );
          g.setAttribute("aria-pressed", i === selected);
          g.style.filter = i === selected ? "drop-shadow(0 0 5px #bde4ff)" : "";
        });
        el("play").textContent = playing ? text.pause : text.play;
        el("play").setAttribute("aria-pressed", playing);
      }
      function updateDetails() {
        const p = planets[selected];
        el("name").textContent = text[p[0]];
        el("kind").textContent =
          selected < 4
            ? text.terrestrialPlanet
            : selected < 6
              ? text.gasGiant
              : text.iceGiant;
        el("distance").textContent = new Intl.NumberFormat(text.locale, {
          style: "unit",
          unit: "kilometer",
          unitDisplay: "short",
          notation: "compact",
          compactDisplay: "long",
          maximumFractionDigits: 2,
        }).format(p[1] * 149597870.7);
        el("orbit").textContent = text.earthYears[selected];
      }
      function updateSpeed() {
        el("speed-value").textContent =
          new Intl.NumberFormat(text.locale, {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
          }).format(Number(el("speed").value)) + "×";
      }
      function tick(now) {
        if (playing && last !== null && !document.hidden) {
          days +=
            Math.min((now - last) / 1000, 0.1) * Number(el("speed").value) * 20;
          draw();
        }
        last = now;
        if (playing) frame = requestAnimationFrame(tick);
      }
      el("play").onclick = () => {
        playing = !playing;
        if (!playing) cancelAnimationFrame(frame);
        if (playing) {
          last = null;
          frame = requestAnimationFrame(tick);
        }
        draw();
      };
      el("speed").oninput = updateSpeed;
      el("reset").onclick = () => {
        cancelAnimationFrame(frame);
        days = 0;
        selected = 5;
        playing = false;
        last = null;
        el("speed").value = el("speed").defaultValue;
        draw();
        updateDetails();
        updateSpeed();
      };
      document.addEventListener("visibilitychange", () => {
        last = null;
      });
      draw();
      updateDetails();
      updateSpeed();
    <\/script>
  </body>
</html>
`})))()}function s(e){let n={locale:e.locale,savingsTitle:e.formatMessage({id:`space.welcome.demo.savingsTitle`,defaultMessage:`Savings growth`,description:`Title of the interactive savings calculator embedded in the Welcome to Space Page`}),monthly:e.formatMessage({id:`space.welcome.demo.monthly`,defaultMessage:`Monthly contribution`,description:`Label for monthly USD deposits in the Welcome Page savings calculator`}),starting:e.formatMessage({id:`space.welcome.demo.starting`,defaultMessage:`Starting savings`,description:`Label for the initial USD balance in the Welcome Page savings calculator`}),years:e.formatMessage({id:`space.welcome.demo.years`,defaultMessage:`Years`,description:`Label for the number of years simulated by the Welcome Page savings calculator`}),rate:e.formatMessage({id:`space.welcome.demo.rate`,defaultMessage:`Annual return`,description:`Label for the assumed yearly percentage return in the Welcome Page savings calculator`}),balance:e.formatMessage({id:`space.welcome.demo.balance`,defaultMessage:`Projected balance`,description:`Savings calculator metric and chart legend showing the simulated final USD balance`}),added:e.formatMessage({id:`space.welcome.demo.added`,defaultMessage:`You contribute`,description:`Savings calculator metric and chart legend showing starting savings plus deposits, excluding growth`}),growth:e.formatMessage({id:`space.welcome.demo.growth`,defaultMessage:`Investment growth`,description:`Savings calculator metric showing simulated interest earned, in USD`}),contributions:e.formatMessage({id:`space.welcome.demo.contributions`,defaultMessage:`Contributions`,description:`Chart legend for starting savings plus deposits in the Welcome Page savings calculator`}),totalBalance:e.formatMessage({id:`space.welcome.demo.totalBalance`,defaultMessage:`Total balance`,description:`Chart legend for savings including investment growth in the Welcome Page savings calculator`}),increaseMonthly:e.formatMessage({id:`space.welcome.demo.increaseMonthly`,defaultMessage:`+$250/mo`,description:`Button that increases monthly contributions by 250 US dollars in the Welcome Page savings calculator`}),reset:e.formatMessage({id:`space.welcome.demo.reset`,defaultMessage:`Reset`,description:`Button to restore the initial state of a Welcome Page interactive example`}),savingsNote:e.formatMessage({id:`space.welcome.demo.savingsNote`,defaultMessage:`Illustrative estimate. Deposits occur at each month’s end; returns compound monthly. Taxes, fees, and inflation are excluded. Actual returns vary.`,description:`Explanatory note below the Welcome Page savings calculator`}),solarTitle:e.formatMessage({id:`space.welcome.demo.solarTitle`,defaultMessage:`Explore the solar system`,description:`Title of the interactive orbital simulation embedded in the Welcome to Space Page`}),sun:e.formatMessage({id:`space.welcome.demo.sun`,defaultMessage:`Sun`,description:`Label for the Sun in the Welcome Page solar system simulation`}),speed:e.formatMessage({id:`space.welcome.demo.speed`,defaultMessage:`Speed`,description:`Label for the playback speed control in the Welcome Page solar system simulation`}),selectedBody:e.formatMessage({id:`space.welcome.demo.selectedBody`,defaultMessage:`Selected body`,description:`Heading above details of the selected planet in the Welcome Page solar system`}),planetYear:e.formatMessage({id:`space.welcome.demo.planetYear`,defaultMessage:`Year`,description:`Label for how long the selected planet takes to orbit the Sun`}),solarPlanets:c,earthYears:c.map(([,,t])=>e.formatMessage({id:`space.welcome.demo.earthYears`,defaultMessage:`{years, plural, one {# Earth year} other {# Earth years}}`,description:`Orbital period of a planet, expressed in Earth years`},{years:Number((t/365.25).toFixed(t<365.25?2:1))})),distanceFromSun:e.formatMessage({id:`space.welcome.demo.distanceFromSun`,defaultMessage:`Distance from Sun`,description:`Label for the selected planet's average distance from the Sun`}),terrestrialPlanet:e.formatMessage({id:`space.welcome.demo.terrestrialPlanet`,defaultMessage:`Terrestrial planet`,description:`Classification of Mercury, Venus, Earth, and Mars in the solar system demo`}),gasGiant:e.formatMessage({id:`space.welcome.demo.gasGiant`,defaultMessage:`Gas giant`,description:`Classification of Jupiter and Saturn in the solar system demo`}),iceGiant:e.formatMessage({id:`space.welcome.demo.iceGiant`,defaultMessage:`Ice giant`,description:`Classification of Uranus and Neptune in the solar system demo`}),solarNote:e.formatMessage({id:`space.welcome.demo.solarNote`,defaultMessage:`Illustrative motion from average orbital periods, not actual current positions. Distances and sizes are compressed for visibility.`,description:`Explanatory note below the Welcome Page solar system simulation`}),pause:e.formatMessage({id:`space.welcome.demo.pause`,defaultMessage:`Pause`,description:`Button to pause orbital motion in the Welcome Page solar system simulation`}),play:e.formatMessage({id:`space.welcome.demo.play`,defaultMessage:`Play`,description:`Button to start orbital motion in the Welcome Page solar system simulation`}),pianoTitle:e.formatMessage({id:`space.welcome.demo.pianoTitle`,defaultMessage:`Mini Piano`,description:`Title of the playable two-octave keyboard embedded in the Welcome to Space Page`}),volume:e.formatMessage({id:`space.welcome.demo.volume`,defaultMessage:`Volume`,description:`Label for the sound volume slider in the Welcome Page piano`}),audioHint:e.formatMessage({id:`space.welcome.demo.audioHint`,defaultMessage:`Tap a key to start audio`,description:`Status inviting the user to activate audio in the Welcome Page piano`}),keyboardHint:e.formatMessage({id:`space.welcome.demo.keyboardHint`,defaultMessage:`Keyboard: A W S E D F T G Y H U J K O L P ; ' ]`,description:`Help text listing the physical keyboard keys that play notes in the Welcome Page piano. Preserve the literal key characters and their order`}),octaveDown:e.formatMessage({id:`space.welcome.demo.octaveDown`,defaultMessage:`Lower octave`,description:`Accessible label for shifting the Welcome Page piano down one octave`}),octaveUp:e.formatMessage({id:`space.welcome.demo.octaveUp`,defaultMessage:`Higher octave`,description:`Accessible label for shifting the Welcome Page piano up one octave`}),audioOn:e.formatMessage({id:`space.welcome.demo.audioOn`,defaultMessage:`Audio on`,description:`Status shown after sound is enabled in the Welcome Page piano`}),audioUnavailable:e.formatMessage({id:`space.welcome.demo.audioUnavailable`,defaultMessage:`Audio unavailable`,description:`Status shown when the browser cannot enable sound in the Welcome Page piano`}),mercury:e.formatMessage({id:`space.welcome.demo.mercury`,defaultMessage:`Mercury`,description:`Selectable planet name in the Welcome Page solar system simulation`}),venus:e.formatMessage({id:`space.welcome.demo.venus`,defaultMessage:`Venus`,description:`Selectable planet name in the Welcome Page solar system simulation`}),earth:e.formatMessage({id:`space.welcome.demo.earth`,defaultMessage:`Earth`,description:`Selectable planet name in the Welcome Page solar system simulation`}),mars:e.formatMessage({id:`space.welcome.demo.mars`,defaultMessage:`Mars`,description:`Selectable planet name in the Welcome Page solar system simulation`}),jupiter:e.formatMessage({id:`space.welcome.demo.jupiter`,defaultMessage:`Jupiter`,description:`Selectable planet name in the Welcome Page solar system simulation`}),saturn:e.formatMessage({id:`space.welcome.demo.saturn`,defaultMessage:`Saturn`,description:`Selectable planet name in the Welcome Page solar system simulation`}),uranus:e.formatMessage({id:`space.welcome.demo.uranus`,defaultMessage:`Uranus`,description:`Selectable planet name in the Welcome Page solar system simulation`}),neptune:e.formatMessage({id:`space.welcome.demo.neptune`,defaultMessage:`Neptune`,description:`Selectable planet name in the Welcome Page solar system simulation`})},i=`<script>const text = ${JSON.stringify(n).replaceAll(`<`,`\\u003c`)};<\/script>`;return{savings:r.replace(`<!--labels-->`,()=>i),solar:a.replace(`<!--labels-->`,()=>i),piano:t.replace(`<!--labels-->`,()=>i)}}var c;function l(){return(l=e((()=>{n(),i(),o(),c=[[`mercury`,.387,87.97,4,`#b5b6bb`],[`venus`,.723,224.7,6,`#e4ca91`],[`earth`,1,365.25,7,`#70b9ff`],[`mars`,1.524,686.98,5,`#e59b83`],[`jupiter`,5.203,4332.59,12,`#e5c496`],[`saturn`,9.537,10759.22,10,`#dfce91`],[`uranus`,19.191,30688.5,8,`#a1dce2`],[`neptune`,30.069,60182,8,`#74a4ee`]]})))()}l();export{s as getWelcomeVisualizations};
//# sourceMappingURL=demos-67428e468897.js.map