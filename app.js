const colors = ["#0f766e", "#1d4ed8", "#9333ea", "#c2410c"];

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

const byCheckedAt = (a, b) => new Date(a.checked_at) - new Date(b.checked_at);

function flightNumberFromOption(option) {
  const flight = option?.flight || "";
  const match = flight.match(/[A-Z]{2}\d+/);
  return match ? match[0] : flight.trim();
}

function trackedPoints(records) {
  return records.flatMap((record) => {
    const points = [];
    if (record.found_price && typeof record.lowest_price_hkd === "number") {
      points.push({
        record,
        option: record.lowest_option || {},
        price: record.lowest_price_hkd,
        label: flightNumberFromOption(record.lowest_option) || record.date || "Direct",
        kind: "Direct",
      });
    }
    if (record.found_transfer_deal && typeof record.transfer_deal_price_hkd === "number") {
      const destination = record.transfer_destination || "JFK";
      points.push({
        record,
        option: record.transfer_deal_option || {},
        price: record.transfer_deal_price_hkd,
        label: `${flightNumberFromOption(record.transfer_deal_option) || record.date} HKG-${destination}`,
        kind: `HKG-${destination} 1-stop deal`,
      });
    }
    return points;
  });
}

function latestByDate(records) {
  const map = new Map();
  records.filter((record) => record.found_price).forEach((record) => map.set(record.date, record));
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function setText(id, text) {
  document.getElementById(id).textContent = text;
}

function renderSummary(records, history) {
  const priced = trackedPoints(records);
  const latest = priced[priced.length - 1];
  const best = priced.reduce((min, point) => (point.price < min.price ? point : min), priced[0]);

  setText("latestFare", latest ? money(latest.price) : "--");
  setText("bestFare", best ? money(best.price) : "--");
  setText("lastChecked", history.updated_at ? shortTime(history.updated_at) : "--");
  setText("recordCount", String(records.length));
}

function renderLatestFlights(records) {
  const container = document.getElementById("latestFlights");
  const latest = latestByDate(records);
  if (!latest.length) {
    container.innerHTML = '<p class="empty">No tracked prices yet.</p>';
    return;
  }

  container.innerHTML = latest
    .map((record) => {
      const option = record.lowest_option || {};
      return `
        <article class="flight-card">
          <div class="date">${record.date}</div>
          <div class="price">${money(record.lowest_price_hkd)}</div>
          <div class="meta">
            <strong>${option.airline || "Unknown airline"}</strong><br />
            ${option.flight || "Unknown flight"} · ${option.depart_time || "--"} -> ${option.arrive_time || "--"}<br />
            ${option.duration || "--"} · ${shortTime(record.checked_at)}
            ${
              record.found_transfer_deal
                ? `<br /><span class="deal-line">HKG-${record.transfer_destination || "JFK"} 1-stop deal: ${money(record.transfer_deal_price_hkd)} · ${
                    record.transfer_deal_option?.flight || "Unknown flight"
                  } · ${record.transfer_deal_option?.duration || "--"}</span>`
                : ""
            }
          </div>
        </article>
      `;
    })
    .join("");
}

function renderTable(records) {
  const body = document.getElementById("recentRows");
  const rows = records
    .filter((record) => record.found_price || record.found_transfer_deal)
    .slice(-12)
    .reverse();

  body.innerHTML = rows
    .map((record) => {
      const option = record.lowest_option || {};
      return `
        <tr>
          <td>${shortTime(record.checked_at)}</td>
          <td>${record.date}</td>
          <td class="price-cell">${money(record.lowest_price_hkd)}</td>
          <td>${option.airline || "--"}</td>
          <td>${option.flight || "--"}</td>
          <td>${option.depart_time || "--"} -> ${option.arrive_time || "--"}</td>
          <td>${record.found_transfer_deal ? `HKG-${record.transfer_destination || "JFK"} · ${money(record.transfer_deal_price_hkd)} · ${record.transfer_deal_option?.flight || "--"}` : "--"}</td>
        </tr>
      `;
    })
    .join("");
}

function renderLegend(series) {
  document.getElementById("legend").innerHTML = series
    .map(
      (item) => `
        <span class="legend-item">
          <span class="legend-swatch" style="background:${item.color}"></span>
          ${item.label}
        </span>
      `
    )
    .join("");
}

function renderChart(records) {
  const svg = document.getElementById("priceChart");
  const width = svg.clientWidth || 800;
  const height = svg.clientHeight || 410;
  const margin = { top: 20, right: 24, bottom: 46, left: 92 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const groups = new Map();
  trackedPoints(records)
    .sort((a, b) => new Date(a.record.checked_at) - new Date(b.record.checked_at))
    .forEach((point) => {
      const key = point.label;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(point);
    });

  const series = [...groups.entries()].map(([label, values], index) => ({
    label,
    values,
    color: colors[index % colors.length],
  }));
  renderLegend(series);

  const all = series.flatMap((item) => item.values);
  if (!all.length) {
    svg.innerHTML = `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" class="chart-label">No price history yet</text>`;
    return;
  }

  const times = all.map((point) => new Date(point.record.checked_at).getTime());
  const prices = all.map((point) => point.price);
  const minT = Math.min(...times);
  const maxT = Math.max(...times);
  const minP = Math.floor(Math.min(...prices) / 500) * 500;
  const maxP = Math.ceil(Math.max(...prices) / 500) * 500;
  const spanT = Math.max(maxT - minT, 1);
  const spanP = Math.max(maxP - minP, 1);

  const x = (time) => margin.left + ((time - minT) / spanT) * innerW;
  const y = (price) => margin.top + innerH - ((price - minP) / spanP) * innerH;

  const grid = Array.from({ length: 5 }, (_, index) => {
    const price = minP + (spanP / 4) * index;
    const yy = y(price);
    return `
      <line class="grid-line" x1="${margin.left}" x2="${width - margin.right}" y1="${yy}" y2="${yy}" />
      <text class="chart-label" x="${margin.left - 12}" y="${yy + 4}" text-anchor="end">${money(Math.round(price))}</text>
    `;
  }).join("");

  const paths = series
    .map((item) => {
      const d = item.values
        .map((point, index) => {
          const coords = `${x(new Date(point.record.checked_at).getTime())},${y(point.price)}`;
          return `${index === 0 ? "M" : "L"}${coords}`;
        })
        .join(" ");
      const dots = item.values
        .map(
          (point) =>
            `<circle cx="${x(new Date(point.record.checked_at).getTime())}" cy="${y(point.price)}" r="4" fill="${item.color}">
              <title>${item.label} ${point.record.date} ${point.kind} ${money(point.price)} at ${shortTime(point.record.checked_at)}</title>
            </circle>`
        )
        .join("");
      return `<path d="${d}" fill="none" stroke="${item.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />${dots}`;
    })
    .join("");

  const firstLabel = shortTime(new Date(minT).toISOString());
  const lastLabel = shortTime(new Date(maxT).toISOString());
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.innerHTML = `
    ${grid}
    <line class="axis" x1="${margin.left}" x2="${width - margin.right}" y1="${height - margin.bottom}" y2="${height - margin.bottom}" />
    <line class="axis" x1="${margin.left}" x2="${margin.left}" y1="${margin.top}" y2="${height - margin.bottom}" />
    <text class="chart-label" x="${margin.left}" y="${height - 14}" text-anchor="start">${firstLabel}</text>
    <text class="chart-label" x="${width - margin.right}" y="${height - 14}" text-anchor="end">${lastLabel}</text>
    ${paths}
  `;
}

async function boot() {
  try {
    const response = await fetch("./data/history.json", { cache: "no-store" });
    const history = await response.json();
    const records = (history.records || []).sort(byCheckedAt);
    renderSummary(records, history);
    renderLatestFlights(records);
    renderTable(records);
    renderChart(records);
    window.addEventListener("resize", () => renderChart(records));
  } catch (error) {
    document.body.innerHTML = `<main class="shell"><section class="panel"><h1>Flight Price Tracker</h1><p class="empty">Unable to load history data.</p></section></main>`;
    console.error(error);
  }
}

boot();
