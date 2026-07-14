const DIRECT_COLORS = ["#0f766e", "#2563eb", "#64748b", "#0891b2"];
const TRANSFER_LIMITS = { price: 9000, duration: 24 * 60 };

const state = {
  history: null,
  records: [],
  transferOptions: [],
  transferSort: "balance",
  transferSortDirection: "asc",
};

const money = (value) =>
  typeof value === "number" ? `HKD ${value.toLocaleString("en-US")}` : "--";

const shortTime = (iso) => {
  if (!iso) return "--";
  return new Intl.DateTimeFormat("en-HK", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
};

const compactDuration = (minutes, fallback = "--") => {
  if (typeof minutes !== "number") return fallback;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${remainder}m`;
  return remainder ? `${hours}h ${String(remainder).padStart(2, "0")}m` : `${hours}h`;
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const byCheckedAt = (a, b) => new Date(a.checked_at) - new Date(b.checked_at);

function flightNumber(option) {
  const flight = option?.flight || "";
  const matches = flight.match(/[A-Z]{2}\d+/g);
  return matches?.join(" + ") || flight.trim();
}

function latestRecordsByDate(records) {
  const latest = new Map();
  records.forEach((record) => latest.set(record.date, record));
  return [...latest.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function optionQualifies(option) {
  return (
    typeof option.price_hkd === "number" &&
    option.price_hkd < TRANSFER_LIMITS.price &&
    typeof option.duration_minutes === "number" &&
    option.duration_minutes <= TRANSFER_LIMITS.duration
  );
}

function optionsForRecord(record) {
  const options = Array.isArray(record.transfer_options) ? record.transfer_options : [];
  if (options.length) return options;
  return record.transfer_deal_option ? [record.transfer_deal_option] : [];
}

function latestTransferOptions(records) {
  return latestRecordsByDate(records).flatMap((record) =>
    optionsForRecord(record).map((option, index) => ({
      ...option,
      date: record.date,
      checked_at: record.checked_at,
      destination: record.transfer_destination || "PHL",
      url: record.transfer_url || "",
      key: `${record.date}-${option.flight}-${option.duration}-${option.price_hkd}-${index}`,
      qualifies: optionQualifies(option),
    }))
  );
}

function connectionDetails(value) {
  const match = String(value || "").match(/^transfer at (.+?) for (.+)$/i);
  if (!match) return { place: value || "--", layover: "" };
  return { place: match[1], layover: match[2] };
}

function setText(id, text) {
  document.getElementById(id).textContent = text;
}

function renderSummary() {
  const latest = latestRecordsByDate(state.records);
  const directPrices = latest
    .map((record) => record.lowest_price_hkd)
    .filter((price) => typeof price === "number");
  const transferPrices = state.transferOptions.map((option) => option.price_hkd);
  const durations = state.transferOptions
    .map((option) => option.duration_minutes)
    .filter((duration) => typeof duration === "number");

  setText("directFare", directPrices.length ? money(Math.min(...directPrices)) : "--");
  setText("transferFare", transferPrices.length ? money(Math.min(...transferPrices)) : "--");
  setText("shortestTrip", durations.length ? compactDuration(Math.min(...durations)) : "--");
  setText("lastChecked", state.history?.updated_at ? shortTime(state.history.updated_at) : "--");
}

function sortTransferOptions(options, mode, direction = "asc") {
  const result = [...options];
  const order = direction === "desc" ? -1 : 1;
  if (mode === "price") {
    return result.sort(
      (a, b) => (a.price_hkd - b.price_hkd || a.duration_minutes - b.duration_minutes) * order
    );
  }
  if (mode === "duration") {
    return result.sort(
      (a, b) => (a.duration_minutes - b.duration_minutes || a.price_hkd - b.price_hkd) * order
    );
  }

  const prices = result.map((option) => option.price_hkd);
  const durations = result.map((option) => option.duration_minutes);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const minDuration = Math.min(...durations);
  const maxDuration = Math.max(...durations);
  const priceSpan = Math.max(maxPrice - minPrice, 1);
  const durationSpan = Math.max(maxDuration - minDuration, 1);

  return result.sort((a, b) => {
    if (a.qualifies !== b.qualifies) return a.qualifies ? -1 : 1;
    const scoreA = ((a.price_hkd - minPrice) / priceSpan) * 0.45 + ((a.duration_minutes - minDuration) / durationSpan) * 0.55;
    const scoreB = ((b.price_hkd - minPrice) / priceSpan) * 0.45 + ((b.duration_minutes - minDuration) / durationSpan) * 0.55;
    return scoreA - scoreB;
  });
}

function renderTransferRows() {
  const body = document.getElementById("transferRows");
  const options = sortTransferOptions(
    state.transferOptions,
    state.transferSort,
    state.transferSortDirection
  );
  const eligibleCount = options.filter((option) => option.qualifies).length;
  setText(
    "transferOverview",
    options.length
      ? `${options.length} current options · ${eligibleCount} meet the 24h and HKD 9,000 alert rule`
      : "No one-stop options below HKD 9,000 in the latest check"
  );

  if (!options.length) {
    body.innerHTML = '<tr><td colspan="7" class="empty-cell">No comparison options captured yet.</td></tr>';
    return;
  }

  body.innerHTML = options
    .map((option) => {
      const connection = connectionDetails(option.transfer);
      const duration = compactDuration(option.duration_minutes, option.duration || "--");
      const overBy = Math.max((option.duration_minutes || 0) - TRANSFER_LIMITS.duration, 0);
      const status = option.qualifies ? "Meets alert rule" : `${compactDuration(overBy)} over limit`;
      return `
        <tr class="${option.qualifies ? "eligible-row" : "outside-row"}">
          <td><strong>${escapeHtml(option.date)}</strong></td>
          <td>
            ${
              option.url
                ? `<a class="flight-combination flight-link" href="${escapeHtml(option.url)}" target="_blank" rel="noopener noreferrer" title="Open Wing On results for ${escapeHtml(option.date)}">${escapeHtml(flightNumber(option) || "Unknown flight")} <span aria-hidden="true">↗</span></a>`
                : `<strong class="flight-combination">${escapeHtml(flightNumber(option) || "Unknown flight")}</strong>`
            }
            <span class="cell-secondary">${escapeHtml(option.airline || "Unknown airline")}</span>
          </td>
          <td>
            <strong>${escapeHtml(connection.place)}</strong>
            <span class="cell-secondary">${connection.layover ? `${escapeHtml(connection.layover)} layover` : "One stop"}</span>
          </td>
          <td>
            <strong>${escapeHtml(option.depart_time || "--")} -> ${escapeHtml(option.arrive_time || "--")}</strong>
            <span class="cell-secondary">Local times</span>
          </td>
          <td class="duration-cell">${escapeHtml(duration)}</td>
          <td class="transfer-price">${money(option.price_hkd)}</td>
          <td><span class="status ${option.qualifies ? "eligible" : "outside"}">${escapeHtml(status)}</span></td>
        </tr>
      `;
    })
    .join("");
}

function renderTransferScatter() {
  const svg = document.getElementById("transferScatter");
  const width = svg.clientWidth || 1080;
  const height = svg.clientHeight || 270;
  const margin = { top: 20, right: 28, bottom: 48, left: 76 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const options = state.transferOptions;

  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  if (!options.length) {
    svg.innerHTML = `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" class="chart-label">No current one-stop options</text>`;
    return;
  }

  const durations = options.map((option) => option.duration_minutes);
  const prices = options.map((option) => option.price_hkd);
  const minD = Math.min(TRANSFER_LIMITS.duration - 60, ...durations);
  const maxD = Math.max(TRANSFER_LIMITS.duration + 60, ...durations);
  const minP = Math.floor((Math.min(...prices) - 250) / 250) * 250;
  const maxP = Math.ceil((Math.max(TRANSFER_LIMITS.price, ...prices) + 250) / 250) * 250;
  const x = (duration) => margin.left + ((duration - minD) / Math.max(maxD - minD, 1)) * innerW;
  const y = (price) => margin.top + innerH - ((price - minP) / Math.max(maxP - minP, 1)) * innerH;

  const yTicks = Array.from({ length: 4 }, (_, index) => minP + ((maxP - minP) / 3) * index);
  const grid = yTicks
    .map(
      (price) => `
        <line class="grid-line" x1="${margin.left}" x2="${width - margin.right}" y1="${y(price)}" y2="${y(price)}" />
        <text class="chart-label" x="${margin.left - 10}" y="${y(price) + 4}" text-anchor="end">${money(Math.round(price))}</text>
      `
    )
    .join("");
  const durationTicks = [minD, TRANSFER_LIMITS.duration, maxD];
  const xLabels = durationTicks
    .map(
      (duration) => `<text class="chart-label" x="${x(duration)}" y="${height - 15}" text-anchor="middle">${compactDuration(Math.round(duration))}</text>`
    )
    .join("");

  const labelKeys = new Set();
  const occupiedCoordinates = new Set();
  for (const option of sortTransferOptions(options, state.transferSort, state.transferSortDirection)) {
    const coordinate = `${Math.round(option.duration_minutes / 10)}-${Math.round(option.price_hkd / 50)}`;
    if (!occupiedCoordinates.has(coordinate) && labelKeys.size < 4) {
      labelKeys.add(option.key);
      occupiedCoordinates.add(coordinate);
    }
  }

  const points = options
    .map((option) => {
      const label = flightNumber(option) || "Flight";
      const colorClass = option.qualifies ? "eligible-point" : "outside-point";
      const pointLabel = labelKeys.has(option.key)
        ? `<text x="${x(option.duration_minutes) + 11}" y="${y(option.price_hkd) + 4}">${escapeHtml(label.split(" + ")[0])}</text>`
        : "";
      return `
        <g class="scatter-point ${colorClass}">
          <circle cx="${x(option.duration_minutes)}" cy="${y(option.price_hkd)}" r="7" />
          ${pointLabel}
          <title>${escapeHtml(`${option.date} ${label} ${compactDuration(option.duration_minutes)} ${money(option.price_hkd)}`)}</title>
        </g>
      `;
    })
    .join("");

  svg.innerHTML = `
    ${grid}
    <line class="axis" x1="${margin.left}" x2="${width - margin.right}" y1="${margin.top + innerH}" y2="${margin.top + innerH}" />
    <line class="axis" x1="${margin.left}" x2="${margin.left}" y1="${margin.top}" y2="${margin.top + innerH}" />
    <line class="duration-limit" x1="${x(TRANSFER_LIMITS.duration)}" x2="${x(TRANSFER_LIMITS.duration)}" y1="${margin.top}" y2="${margin.top + innerH}" />
    <text class="limit-label" x="${x(TRANSFER_LIMITS.duration) + 7}" y="${margin.top + 13}">24h alert limit</text>
    ${xLabels}
    ${points}
  `;
}

function directPoints(records) {
  return records
    .filter((record) => record.found_price && typeof record.lowest_price_hkd === "number")
    .map((record) => ({
      record,
      price: record.lowest_price_hkd,
      label: flightNumber(record.lowest_option) || record.date || "Direct",
    }));
}

function renderDirectLegend(series) {
  document.getElementById("directLegend").innerHTML = series
    .map(
      (item) => `
        <span class="legend-item">
          <span class="legend-swatch" style="background:${item.color}"></span>
          ${escapeHtml(item.label)}
        </span>
      `
    )
    .join("");
}

function renderDirectChart() {
  const svg = document.getElementById("directChart");
  const width = svg.clientWidth || 800;
  const height = svg.clientHeight || 360;
  const margin = { top: 18, right: 20, bottom: 44, left: 88 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const groups = new Map();

  directPoints(state.records).forEach((point) => {
    if (!groups.has(point.label)) groups.set(point.label, []);
    groups.get(point.label).push(point);
  });
  const series = [...groups.entries()].map(([label, values], index) => ({
    label,
    values,
    color: DIRECT_COLORS[index % DIRECT_COLORS.length],
  }));
  renderDirectLegend(series);

  const all = series.flatMap((item) => item.values);
  if (!all.length) {
    svg.innerHTML = `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" class="chart-label">No direct fare history yet</text>`;
    return;
  }

  const times = all.map((point) => new Date(point.record.checked_at).getTime());
  const prices = all.map((point) => point.price);
  const minT = Math.min(...times);
  const maxT = Math.max(...times);
  const minP = Math.floor(Math.min(...prices) / 500) * 500;
  const maxP = Math.ceil(Math.max(...prices) / 500) * 500;
  const x = (time) => margin.left + ((time - minT) / Math.max(maxT - minT, 1)) * innerW;
  const y = (price) => margin.top + innerH - ((price - minP) / Math.max(maxP - minP, 1)) * innerH;
  const grid = Array.from({ length: 4 }, (_, index) => minP + ((maxP - minP) / 3) * index)
    .map(
      (price) => `
        <line class="grid-line" x1="${margin.left}" x2="${width - margin.right}" y1="${y(price)}" y2="${y(price)}" />
        <text class="chart-label" x="${margin.left - 10}" y="${y(price) + 4}" text-anchor="end">${money(Math.round(price))}</text>
      `
    )
    .join("");
  const paths = series
    .map((item) => {
      const d = item.values
        .map((point, index) => `${index ? "L" : "M"}${x(new Date(point.record.checked_at).getTime())},${y(point.price)}`)
        .join(" ");
      const dots = item.values
        .map(
          (point) => `<circle cx="${x(new Date(point.record.checked_at).getTime())}" cy="${y(point.price)}" r="3" fill="${item.color}"><title>${escapeHtml(`${item.label} ${money(point.price)} ${shortTime(point.record.checked_at)}`)}</title></circle>`
        )
        .join("");
      return `<path d="${d}" fill="none" stroke="${item.color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />${dots}`;
    })
    .join("");

  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.innerHTML = `
    ${grid}
    <line class="axis" x1="${margin.left}" x2="${width - margin.right}" y1="${height - margin.bottom}" y2="${height - margin.bottom}" />
    <text class="chart-label" x="${margin.left}" y="${height - 13}" text-anchor="start">${shortTime(new Date(minT).toISOString())}</text>
    <text class="chart-label" x="${width - margin.right}" y="${height - 13}" text-anchor="end">${shortTime(new Date(maxT).toISOString())}</text>
    ${paths}
  `;
}

function renderLatestDirect() {
  const container = document.getElementById("latestDirect");
  const latest = latestRecordsByDate(state.records).filter((record) => record.found_price);
  if (!latest.length) {
    container.innerHTML = '<p class="empty">No direct prices yet.</p>';
    return;
  }

  container.innerHTML = latest
    .map((record) => {
      const option = record.lowest_option || {};
      return `
        <article class="direct-row">
          <div>
            <span class="row-date">${escapeHtml(record.date)}</span>
            <strong>${money(record.lowest_price_hkd)}</strong>
          </div>
          <div class="direct-meta">
            <strong>${escapeHtml(flightNumber(option) || "Unknown flight")}</strong>
            <span>${escapeHtml(option.depart_time || "--")} -> ${escapeHtml(option.arrive_time || "--")} · ${escapeHtml(option.duration || "--")}</span>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderRecentChecks() {
  const rows = state.records.slice(-10).reverse();
  document.getElementById("recentRows").innerHTML = rows
    .map(
      (record) => `
        <tr>
          <td>${shortTime(record.checked_at)}</td>
          <td>${escapeHtml(record.date)}</td>
          <td>${escapeHtml(flightNumber(record.lowest_option) || "--")}</td>
          <td class="direct-price">${money(record.lowest_price_hkd)}</td>
        </tr>
      `
    )
    .join("");
}

function renderTransferBoard() {
  renderTransferRows();
  renderTransferScatter();
  document.querySelectorAll("[data-sort]").forEach((button) => {
    const active =
      button.dataset.sort === state.transferSort &&
      (state.transferSort === "balance" || state.transferSortDirection === "asc");
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll("[data-column-sort]").forEach((button) => {
    const active = button.dataset.columnSort === state.transferSort;
    const heading = button.closest("th");
    const arrow = button.querySelector(".sort-arrow");
    const direction = active ? state.transferSortDirection : null;
    heading.setAttribute("aria-sort", direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none");
    arrow.textContent = direction === "asc" ? "↑" : direction === "desc" ? "↓" : "↕";
  });
}

function renderAll() {
  renderSummary();
  renderTransferBoard();
  renderDirectChart();
  renderLatestDirect();
  renderRecentChecks();
}

function bindControls() {
  document.querySelectorAll("[data-sort]").forEach((button) => {
    button.addEventListener("click", () => {
      state.transferSort = button.dataset.sort;
      state.transferSortDirection = "asc";
      renderTransferBoard();
    });
  });
  document.querySelectorAll("[data-column-sort]").forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button.dataset.columnSort;
      state.transferSortDirection =
        state.transferSort === mode && state.transferSortDirection === "asc" ? "desc" : "asc";
      state.transferSort = mode;
      renderTransferBoard();
    });
  });
}

async function boot() {
  try {
    const response = await fetch(`./data/history.json?v=${Date.now()}`, { cache: "no-store" });
    state.history = await response.json();
    state.records = (state.history.records || []).sort(byCheckedAt);
    state.transferOptions = latestTransferOptions(state.records);
    bindControls();
    renderAll();
    window.addEventListener("resize", () => {
      renderTransferScatter();
      renderDirectChart();
    });
  } catch (error) {
    document.body.innerHTML = '<main class="shell"><section class="panel"><h1>Flight Price Tracker</h1><p class="empty">Unable to load history data.</p></section></main>';
    console.error(error);
  }
}

boot();
