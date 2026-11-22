(() => {
  function numericValue(raw) {
    const text = String(raw ?? "").trim().replaceAll(",", "");
    if (!text) return null;
    const value = Number(text);
    return Number.isFinite(value) ? value : null;
  }

  function datePreset(kind, today) {
    const [year, month] = today.split("-").map(Number);
    const iso = date => date.toISOString().slice(0, 10);
    const monthDate = (offset, day) => new Date(Date.UTC(year, month - 1 + offset, day));
    if (["1", "7", "30", "90"].includes(kind)) {
      // Latest complete calendar days in Thailand; today's readings are incomplete.
      return [iso(new Date(Date.parse(today) - Number(kind) * 86400000)),
        iso(new Date(Date.parse(today) - 86400000))];
    }
    if (kind === "month") return [iso(monthDate(0, 1)), today];
    if (kind === "previous") return [iso(monthDate(-1, 1)), iso(monthDate(0, 0))];
    if (kind === "three") return [iso(monthDate(-3, 1)), iso(monthDate(0, 0))];
    return null;
  }

  function seriesStats(points) {
    let sum = 0, count = 0, min = Infinity, max = -Infinity;
    for (const point of points) {
      if (!Number.isFinite(point.value)) continue;
      sum += point.value;
      count++;
      min = Math.min(min, point.value);
      max = Math.max(max, point.value);
    }
    const average = count ? sum / count : null;
    return {average, min: count ? min : null, max: count ? max : null,
      loadFactor: count && max !== 0 ? average / max : null, count};
  }

  function axisScale(lines) {
    let low = Infinity, high = -Infinity;
    for (const line of lines) for (const point of line.points) {
      if (!Number.isFinite(point.value)) continue;
      low = Math.min(low, point.value);
      high = Math.max(high, point.value);
    }
    if (!Number.isFinite(low)) return {low:0, high:1, step:1, levels:1};
    const padding = (high - low) * .08 || Math.max(Math.abs(high) * .05, 1);
    const target = Math.max(1, (high - low + 2 * padding) / 4);
    const magnitude = 10 ** Math.floor(Math.log10(target));
    const step = [1, 2, 5, 10].find(value => value * magnitude >= target) * magnitude;
    low = Math.floor((low - padding) / step) * step;
    high = Math.ceil((high + padding) / step) * step;
    return {low, high, step, levels:Math.round((high - low) / step)};
  }

  function rawCsv(series) {
    const quote = value => '"' + String(value ?? "").replaceAll('"', '""') + '"';
    // Text columns are neutralized for Excel formulas; numeric values stay numeric.
    const safeText = value => /^[=+\-@\t\r\n]/.test(value) ? "'" + value : value;
    const rows = [["PK_POINT", "PNAME", "UNIT", "TIMESTAMP (+07:00)", "VALUE"]];
    for (const line of series) for (const point of line.points) {
      const stamp = new Date(point.time + 7 * 3600000).toISOString().slice(0,19).replace("T", " ");
      rows.push([line.pk, safeText(line.name), line.unit, stamp,
        Number.isFinite(point.value) ? (point.rawValue ?? point.value) : safeText(String(point.rawValue ?? ""))]);
    }
    return "\uFEFF" + rows.map(row => row.map(quote).join(",")).join("\r\n") + "\r\n";
  }

  function sumSeries(lines, range) {
    const times = new Map();
    // Keep an explicit gap when no member reports a scheduled half-hour sample.
    if (range && Number.isFinite(range.from) && Number.isFinite(range.through)) {
      for (let time=range.from; time<=range.through; time+=30*60000) times.set(time,{sum:0,count:0});
    }
    for (const line of lines) {
      const unique = new Map(line.points.map(point => [point.time, point.value]));
      for (const [time, value] of unique) {
        const total = times.get(time) || {sum:0,count:0};
        if (Number.isFinite(value)) { total.sum += value; total.count++; }
        times.set(time,total);
      }
    }
    return Array.from(times, ([time,total]) => ({
      time, value:total.count > 0 ? total.sum : null,
      availableCount:total.count, totalCount:lines.length
    })).sort((a,b)=>a.time-b.time);
  }

  window.NccPeriodUtils = {sumSeries, numericValue, datePreset, seriesStats, axisScale, rawCsv};
})();
