function integratePower(points) {
  let positive = 0, negative = 0, hours = 0;
  // Integrate each continuous run independently across missing measurements.
  function integrateRun(run) {
    if (run.length < 2) return;
    const widths = [], slopes = [];
    for (let i = 1; i < run.length; i++) {
      const h = (run[i].time - run[i-1].time) / 3600000;
      widths.push(h);
      slopes.push((run[i].value - run[i-1].value) / h);
    }
    function endpoint(h0, h1, d0, d1) {
      const derivative = ((2*h0+h1)*d0-h0*d1)/(h0+h1);
      if (Math.sign(derivative) !== Math.sign(d0)) return 0;
      if (Math.sign(d0) !== Math.sign(d1) && Math.abs(derivative) > 3*Math.abs(d0)) return 3*d0;
      return derivative;
    }
    const derivatives = new Array(run.length);
    if (run.length === 2) derivatives.fill(slopes[0]);
    else {
      derivatives[0] = endpoint(widths[0], widths[1], slopes[0], slopes[1]);
      const last = slopes.length-1;
      derivatives[run.length-1] = endpoint(widths[last], widths[last-1], slopes[last], slopes[last-1]);
      for (let i = 1; i < run.length-1; i++) {
        const left = slopes[i-1], right = slopes[i];
        if (left === 0 || right === 0 || Math.sign(left) !== Math.sign(right)) derivatives[i] = 0;
        else {
          const w1 = 2*widths[i]+widths[i-1];
          const w2 = widths[i]+2*widths[i-1];
          derivatives[i] = (w1+w2)/(w1/left+w2/right);
        }
      }
    }
    for (let i = 0; i < widths.length; i++) {
      const h = widths[i], y0 = run[i].value, y1 = run[i+1].value;
      // Hermite polynomial in normalized time u in [0,1].
      const c = h*derivatives[i];
      const a = 2*(y0-y1)+c+h*derivatives[i+1];
      const b = 3*(y1-y0)-2*c-h*derivatives[i+1];
      const value = u => ((a*u+b)*u+c)*u+y0;
      const primitive = u => h*(a*u**4/4+b*u**3/3+c*u*u/2+y0*u);
      const cuts = [0];
      if (Math.sign(y0)*Math.sign(y1) < 0) {
        let lo = 0, hi = 1;
        for (let iteration = 0; iteration < 60; iteration++) {
          const mid = (lo+hi)/2;
          if (Math.sign(value(mid)) === Math.sign(y0)) lo = mid;
          else hi = mid;
        }
        cuts.push((lo+hi)/2);
      }
      cuts.push(1);
      for (let j = 1; j < cuts.length; j++) {
        const area = primitive(cuts[j])-primitive(cuts[j-1]);
        if (value((cuts[j]+cuts[j-1])/2) >= 0) positive += Math.max(0,area);
        else negative += Math.max(0,-area);
      }
      hours += h;
    }
  }
  let run = [];
  for (const point of points) {
    if (!Number.isFinite(point.time) || !Number.isFinite(point.value)) {
      integrateRun(run);
      run = [];
      continue;
    }
    if (run.length && point.time <= run[run.length-1].time) {
      integrateRun(run);
      run = [];
    }
    run.push(point);
  }
  integrateRun(run);
  return {positive, negative, net:positive-negative, hours};
}

function createPeriodChart(container, status) {
  const cache = new Map();
  const dateFormat = new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  });
  let generation = 0;
  let observer;
  let timer;
  let axisListener;
  const dualAxis = document.querySelector("#dual-axis");

  function invalidate() {
    generation++;
    if (axisListener) dualAxis.removeEventListener("change", axisListener);
    axisListener = null;
        clearInterval(timer);
    status.parentNode.querySelector("[data-elapsed]")?.remove();
    container.hidden = true;
    status.textContent = "";

    observer?.disconnect();
  }


  async function fetchPoints(pk, start, end) {
    const parse = text => new DOMParser().parseFromString(text, "application/xml");
    let xml = parse(await window.nccPeriod(pk, start, end));
    if (xml.documentElement.localName === "string") xml = parse(xml.documentElement.textContent);
    if (xml.querySelector("parsererror") || !["DataSet","NewDataSet"].includes(xml.documentElement.localName)) throw Error("XML");
    const points = [];
    let skipped = 0;
    for (const row of xml.getElementsByTagNameNS("*","val")) {
      const field = key => row.getElementsByTagNameNS("*",key)[0]?.textContent.trim() ?? "";
      if (field("FK_MEASUREMENT") && field("FK_MEASUREMENT") !== pk) continue;
      const raw = field("TIMESTAMP");
      const stamp = Date.parse(/(?:Z|[+-]\d\d:\d\d)$/i.test(raw) ? raw : raw + "+07:00");
      const value = field("VALUE");
      if (!Number.isFinite(stamp)) { skipped++; continue; }
      points.push({time:stamp,value:NccPeriodUtils.numericValue(value),rawValue:value});
    }
    points.sort((a,b)=>a.time-b.time);
    return {points, skipped, byTime:new Map(points.map(p=>[p.time,p]))};
  }

  const chunkCache = new Map();
  async function loadPoints(pk, start, end, request, progress) {
    const merged = new Map();
    let skipped = 0;
    // NCC returns 00:30 through the following midnight for each requested day.
    // Include the preceding day to obtain the selected first day's 00:00 sample.
    let cursor = new Date(Date.parse(start)-86400000).toISOString().slice(0,10);
    const from = Date.parse(start+"T00:00:00+07:00");
    const through = Date.parse(end+"T23:30:00+07:00");
    const days = (a,b) => Math.round((Date.parse(b)-Date.parse(a))/86400000);
    async function readChunk(first,last) {
      if (request !== generation) throw Error("Cancelled");
      const key = JSON.stringify([pk,first,last]);
      let task = chunkCache.get(key);
      if (!task) {
        task = fetchPoints(pk,first,last);
        chunkCache.set(key,task);
        if(chunkCache.size>512) chunkCache.delete(chunkCache.keys().next().value);
      }
      try {
        const data = await task;
        if(!data.points.length) chunkCache.delete(key);
        return data;
      } catch(error) {
        chunkCache.delete(key);
        if(request !== generation || days(first,last)<=1) throw error;
        const middle = new Date(Date.parse(first)+Math.floor(days(first,last)/2)*86400000).toISOString().slice(0,10);
        const left = await readChunk(first,middle);
        const right = await readChunk(middle,last);
        return {points:left.points.concat(right.points),skipped:left.skipped+right.skipped};
      }
    }
    do {
      if(request !== generation) throw Error("Cancelled");
      const boundary = new Date(Date.parse(cursor)+7*86400000).toISOString().slice(0,10);
      const stop = boundary < end ? boundary : end;
      progress(cursor,stop);
      const data = await readChunk(cursor,stop);
      skipped += data.skipped;
      for(const point of data.points) {
        if(point.time >= from && point.time <= through) merged.set(point.time,point);
      }
      if(stop === end) break;
      cursor = stop;
    } while(cursor <= end);
    const points = Array.from(merged.values()).sort((a,b)=>a.time-b.time);
    return {points,skipped,byTime:merged};
  }

  const show = async (selected, start, end) => {
    const requestedSeries = selected;
    selected = Array.from(new Map(selected.flatMap(item=>item.members || [item]).map(item=>[item.pk,item])).values());
    const pk = selected.map(item => item.pk).join("_");
    const name = "กราฟเปรียบเทียบจุดวัด";
    invalidate();
    const request = generation;
    const started = performance.now();
    const elapsed = document.createElement("span");
    elapsed.style.cssText = "display:block;font-variant-numeric:tabular-nums;margin:8px 0";
    status.after(elapsed);
    for (const old of status.parentNode.querySelectorAll("[data-elapsed]")) old.remove();
    elapsed.dataset.elapsed = "true";
    const updateTime = () => elapsed.textContent = "กำลังประมวลผล " + ((performance.now()-started)/1000).toFixed(1) + " วินาที";
    updateTime();
    timer = setInterval(updateTime,100);

    if (!window.nccPeriod) {
          clearInterval(timer);
      elapsed.remove();
      status.textContent = "กรุณา Reload ส่วนขยาย NCC Point Lookup แล้วรีเฟรชหน้า เพื่อใช้งานกราฟช่วงวันที่";
      return;
    }

    status.textContent = "กำลังโหลดข้อมูลเพื่อสร้างกราฟ…";
    try {
      const points = [];
      let series = [];
      const failures = [];
      let skipped = 0;
      let next = 0;
      let complete = 0;
      async function loadNext() {
        while (next < selected.length && request === generation) {
          const index = next++;
          const selectedPoint = selected[index];
          const line = {...selectedPoint, color:"hsl(" + ((190 + index * 137.508) % 360) + " 70% 35%)", points:[]};
          series[index] = line;
          const key = JSON.stringify([selectedPoint.pk, start, end]);
          try {
            let data = cache.get(key);
            if (!data) {
              data = await loadPoints(selectedPoint.pk, start, end, request, (first,last) => {
                if(request === generation) status.textContent = "กำลังอ่าน " + selectedPoint.pk + " ช่วง " + first + " ถึง " + last;
              });
              if (data.points.length) cache.set(key, data);
              if (cache.size > 64) cache.delete(cache.keys().next().value);
            }
            if (request !== generation) return;
            line.points = data.points;
            line.byTime = data.byTime;
            skipped += data.skipped;

          } catch {
            failures.push(selectedPoint.pk);
          }
          complete++;
          if (request === generation) status.textContent = "โหลดแล้ว " + complete + "/" + selected.length + " จุดวัด";
        }
      }
      await Promise.all(Array.from({length:Math.min(3, selected.length)}, loadNext));
      if (request !== generation) return;
      const loaded = new Map(series.map(line=>[line.pk,line]));
      series = requestedSeries.map((item,index)=>{
        if (!item.members) return loaded.get(item.pk);
        const summed = NccPeriodUtils.sumSeries(item.members.map(member=>loaded.get(member.pk)), {
          from:Date.parse(start+"T00:00:00+07:00"), through:Date.parse(end+"T23:30:00+07:00")
        });
        return {...item, color:"hsl("+((190+index*137.508)%360)+" 70% 35%)", points:summed, byTime:new Map(summed.map(point=>[point.time,point]))};
      });
      for (const line of series) for (const point of line.points) points.push(point);
      if (request !== generation) return;
      points.sort((a, b) => a.time - b.time);
      if (!points.some(point => point.value !== null)) {
        status.textContent = failures.length ? "ดึงข้อมูลไม่สำเร็จหรือหมดเวลารอ สำหรับจุดวัด " + failures.join(", ") + " กรุณากดแสดงข้อมูลอีกครั้ง ระบบจะใช้ช่วงที่โหลดสำเร็จแล้ว" : "ไม่มีค่าข้อมูลสำหรับจุดวัดและช่วงวันที่นี้";
        return;
      }
      container.replaceChildren();
      container.hidden = false;
      const heading = document.createElement("h2");
      heading.textContent = name;
      const range = document.createElement("p");
      const thaiDay = day => new Intl.DateTimeFormat("th-TH", {day:"numeric", month:"long", year:"numeric", timeZone:"UTC"}).format(new Date(day));
      range.textContent = thaiDay(start) + " เวลา 00:00 – " + thaiDay(end) + " เวลา 23:30 น.";
      const canvas = document.createElement("canvas");
      canvas.style.cssText = "width:100%;height:440px;display:block";
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", "กราฟค่า " + name + " ตามเวลา");
      const detail = document.createElement("div");
      detail.style.margin="16px 0";
      detail.textContent = "ชี้บนกราฟเพื่อดูวันเวลาและค่า";
      const unitOf = name => name.match(/\(([^()]*)\)\s*$/)?.[1].trim() || "ไม่ระบุหน่วย";
      const firstUnit = unitOf(series[0].name);
      for (const line of series) {
        line.unit = unitOf(line.name);
        line.axis = line.unit === firstUnit ? "left" : "right";
        line.stats = NccPeriodUtils.seriesStats(line.points);
      }
      const legend = document.createElement("div");
      legend.style.cssText = "display:flex;flex-wrap:wrap;gap:8px 18px;margin:12px 0";
      for (const line of series) {
        const label = document.createElement("span");
        const swatch = document.createElement("span");
        swatch.style.cssText = "display:inline-block;width:24px;border-top:3px solid "+line.color+";margin-right:6px;vertical-align:middle";
        label.append(swatch,line.name+" · "+line.pk+(line.points.some(p=>p.value!==null) ? "" : " (ไม่มีข้อมูล)"));
        const side = document.createElement("select");
        side.className = "axis-select";
        side.setAttribute("aria-label", "แกน Y ของ " + line.name);
        side.add(new Option("แกนซ้าย", "left"));
        side.add(new Option("แกนขวา", "right"));
        side.value = line.axis;
        side.hidden = !dualAxis.checked;
        side.onchange = () => { line.axis = side.value; draw(); };
        label.append(side);
        legend.append(label);
      }
      const energies = series.filter(line => /\(MW\)/i.test(line.name)).map(line => ({
        ...line, energy:integratePower(line.points)
      }));
      const energyNumber = value => value.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
      const energyBox = document.createElement("div");
      energyBox.className = "energy-summary";
      const energyTitle = document.createElement("strong");
      energyTitle.textContent = "พลังงานไฟฟ้า (MWh) คำนวณด้วยเทคนิค PCHIP";
      energyBox.append(energyTitle);
      const energyTable = document.createElement("table");
      energyTable.className = "energy-table";
      const energyHeader = energyTable.createTHead().insertRow();
      for (const label of ["จุดวัด","ส่วนบวก","ส่วนลบ","สุทธิ","ส่วนบวก (%)","ส่วนลบ (%)"]) {
        const headerCell = document.createElement("th");
        headerCell.scope = "col";
        headerCell.textContent = label;
        energyHeader.append(headerCell);
      }
      const energyBody = energyTable.createTBody();
      function appendEnergy(name, energy, color, isTotal = false) {
        const row = energyBody.insertRow();
        if (isTotal) row.className = "energy-total";
        row.insertCell().textContent = name;
        row.cells[0].style.borderLeft = "4px solid " + color;
        for (const key of ["positive","negative","net"]) {
          const cell = row.insertCell();
          cell.textContent = energy.hours > 0 ? energyNumber(energy[key]) : "ไม่มีช่วงข้อมูล";
        }
        const area = energy.positive + energy.negative;
        for (const key of ["positive","negative"]) {
          row.insertCell().textContent = area > 0 ? energyNumber(100 * energy[key] / area) + "%" : "—";
        }
      }
      for (const line of energies) appendEnergy(line.name+" · "+line.pk,line.energy,line.color);
      if (energies.length > 1) {
        const total = energies.reduce((sum,line) => {
          for (const key of ["positive","negative","net","hours"]) sum[key] += line.energy[key];
          return sum;
        },{positive:0,negative:0,net:0,hours:0});
        appendEnergy("รวมจุดวัด MW ที่มีข้อมูล",total,"#193e43",true);
      }
      const energyScroll = document.createElement("div");
      energyScroll.className = "energy-table-wrap";
      energyScroll.append(energyTable);
      energyBox.append(energyScroll);
      const positiveArea = energies.reduce((sum,line) => sum + line.energy.positive, 0);
      const negativeArea = energies.reduce((sum,line) => sum + line.energy.negative, 0);
      const totalArea = positiveArea + negativeArea;
      const distribution = document.createElement("div");
      distribution.style.cssText = "display:flex;align-items:center;gap:20px;flex-wrap:wrap;margin:16px 0";
      const pie = document.createElement("canvas");
      pie.width = pie.height = 320;
      pie.style.cssText = "width:160px;height:160px";
      const pieContext = pie.getContext("2d");
      const split = -Math.PI / 2 + (totalArea ? positiveArea / totalArea : 0) * Math.PI * 2;
      function slice(from,to,color) {
        pieContext.beginPath();pieContext.moveTo(160,160);pieContext.arc(160,160,150,from,to);pieContext.closePath();
        pieContext.fillStyle=color;pieContext.fill();
      }
      slice(-Math.PI/2,split,"#138b76");
      slice(split,Math.PI*1.5,totalArea ? "#d66b45" : "#d4dddd");
      const pieLabel = totalArea ? "พื้นที่รวมทั้งหมด · ส่วนบวก " + energyNumber(100*positiveArea/totalArea) + "% · ส่วนลบ " + energyNumber(100*negativeArea/totalArea) + "%" : "ไม่มีพื้นที่สำหรับคำนวณสัดส่วน";
      pie.setAttribute("role","img");pie.setAttribute("aria-label",pieLabel);
      const legendArea = document.createElement("div");
      legendArea.textContent = pieLabel;
      const colors = document.createElement("p");
      colors.textContent = "สีเขียว = ส่วนบวก · สีส้ม = ส่วนลบ · ฐาน = ส่วนบวก + ขนาดส่วนลบ";
      legendArea.append(colors);
      distribution.append(pie,legendArea);
      energyBox.append(distribution);

      const note = document.createElement("small");
      note.textContent = energies.length ? "สุทธิ = ส่วนบวก − ขนาดส่วนลบ · คำนวณตามเวลาข้อมูลจริงด้วยเส้นโค้ง PCHIP ข้ามคู่ที่ไม่มีค่า" : "เลือกจุดวัดหน่วย (MW) เพื่อคำนวณพลังงาน";
      energyBox.append(note);
      const chartInfo = document.createElement("div");
      const statsTable = document.createElement("table");
      statsTable.className = "stats-table";
      const statsHeader = statsTable.createTHead().insertRow();
      for (const title of ["จุดวัด","Average","Load Factor"]) statsHeader.appendChild(document.createElement("th")).textContent = title;
      const statsBody = statsTable.createTBody();
      for (const line of series) {
        const row = statsBody.insertRow();
        row.insertCell().textContent = line.name + " · " + line.pk;
        row.insertCell().textContent = line.stats.average === null ? "—" : energyNumber(line.stats.average) + " " + line.unit;
        row.insertCell().textContent = line.stats.loadFactor === null ? "—" : energyNumber(line.stats.loadFactor * 100) + "%";
      }
      const statsNote = document.createElement("small");
      statsNote.textContent = "Average = ค่าเฉลี่ยเลขคณิตของข้อมูลที่มีค่า · Load Factor = Avg/Max × 100% (ใช้ค่ารวมเครื่องหมาย; Max = 0 แสดง —)";
      const statsScroll = document.createElement("div");
      statsScroll.style.overflowX = "auto";
      statsScroll.append(statsTable);
      chartInfo.append(heading,range,legend,statsScroll,statsNote);
      if (series.some(line=>line.members)) {
        const coverageNote=document.createElement("p");
        coverageNote.textContent="ผลรวมใช้เฉพาะจุดวัดที่มีข้อมูลในแต่ละเวลา · ชี้กราฟเพื่อดูจำนวนจุดวัดที่มีข้อมูล / ทั้งหมด";
        chartInfo.append(coverageNote);
      }
      const chartHeader = document.createElement("div");
      chartHeader.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,720px),1fr));gap:20px;align-items:start;margin-bottom:16px";
      chartHeader.append(chartInfo,energyBox);
      container.append(chartHeader, canvas, detail);
      const valid = points.filter(point => point.value !== null);
      const extrema = [];
      for (const line of series) {
        const values = line.points.filter(p=>p.value!==null);
        if (!values.length) continue;
        extrema.push({label:line.pk+" Max",line,point:values.reduce((a,b)=>a.value>=b.value?a:b)},
                     {label:line.pk+" Min",line,point:values.reduce((a,b)=>a.value<=b.value?a:b)});
      }
      const chartTop = 24;
      const plotHeight = 640;
      const summaryTop = chartTop + plotHeight + 64;
      const chartHeight = summaryTop + Math.ceil(extrema.length/2)*58 + 16;
      canvas.style.height = chartHeight+"px";
      const first = Date.parse(start+"T00:00:00+07:00"), last = Date.parse(end+"T23:30:00+07:00");
      const base = document.createElement("canvas");
      let width, left, plotWidth;
      let hoverTime = null;
      function paintCursor() {
        const ctx=canvas.getContext("2d");
        ctx.setTransform(1,0,0,1,0,0);
        ctx.drawImage(base,0,0);
        if (hoverTime === null) return;
        const ratio=canvas.width/width;
        const px=left+(hoverTime-first)/(last-first || 1)*plotWidth;
        ctx.save();
        ctx.scale(ratio,ratio);
        ctx.strokeStyle="#526269";
        ctx.lineWidth=1;
        ctx.setLineDash([5,4]);
        ctx.beginPath();ctx.moveTo(px,chartTop);ctx.lineTo(px,chartTop+plotHeight);ctx.stroke();
        ctx.restore();
      }
      function draw(exportWidth) {
        width = typeof exportWidth === "number" ? exportWidth : canvas.clientWidth;
        if (!width) return;
        const ratio = typeof exportWidth === "number" ? 2 : (devicePixelRatio || 1);
        canvas.width = width * ratio;
        canvas.height = chartHeight * ratio;
        const ctx = canvas.getContext("2d");
        ctx.scale(ratio, ratio);
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, width, chartHeight);
        ctx.font = "12px sans-serif";
        const groups = dualAxis.checked
          ? [series.filter(line => line.axis === "left"), series.filter(line => line.axis === "right")]
          : [series, []];
        const scales = groups.map(NccPeriodUtils.axisScale);
        const tickLabels = scale => Array.from({length:scale.levels+1}, (_,i)=>(scale.high-scale.step*i).toLocaleString("en-US",{maximumFractionDigits:0}));
        const leftLabels = tickLabels(scales[0]);
        const rightLabels = tickLabels(scales[1]);
        left = Math.max(60, ...leftLabels.map(label => ctx.measureText(label).width+14));
        const right = dualAxis.checked ? Math.max(60,...rightLabels.map(label=>ctx.measureText(label).width+14)) : 18;
        plotWidth = Math.max(1, width-left-right);
        const x = time => left + (time-first)/(last-first || 1)*plotWidth;
        const y = (value,line) => {
          const scale = scales[dualAxis.checked && line.axis === "right" ? 1 : 0];
          return chartTop+(scale.high-value)/(scale.high-scale.low)*plotHeight;
        };
        function drawAxis(side, scale, labels, lines) {
          labels.forEach((label,i)=>{
            const py=chartTop+i*plotHeight/scale.levels;
            const isZero = Math.abs(scale.high-scale.step*i) < scale.step*1e-8;
            if (side === 0 || isZero) {
              ctx.strokeStyle=isZero ? "#000000" : "#d9e4e4";
              ctx.lineWidth=isZero ? 3 : 1;
              ctx.beginPath();ctx.moveTo(left,py);ctx.lineTo(left+plotWidth,py);ctx.stroke();
            }
            ctx.fillStyle="#193e43";
            ctx.textAlign=side === 0 ? "right" : "left";
            ctx.fillText(label,side === 0 ? left-8 : left+plotWidth+8,py+4);
          });
          ctx.textAlign=side === 0 ? "left" : "right";
          ctx.fillText((side === 0 ? "ซ้าย" : "ขวา")+" · "+Array.from(new Set(lines.map(line=>line.unit))).join(" / "),
            side === 0 ? left : left+plotWidth,14,plotWidth/2);
        }
        drawAxis(0,scales[0],leftLabels,groups[0]);
        if(dualAxis.checked) drawAxis(1,scales[1],rightLabels,groups[1]);
        for (const line of series) {
          ctx.strokeStyle = line.color; ctx.lineWidth = 2; ctx.beginPath();
          let connected = false;
          for (const point of line.points) {
            if (point.value === null) { connected=false; continue; }
            if (connected) ctx.lineTo(x(point.time),y(point.value,line));
            else ctx.moveTo(x(point.time),y(point.value,line));
            connected=true;
          }
          ctx.stroke();
        }
        extrema.forEach(({label, point, line}, index) => {
          const px = x(point.time), py = y(point.value,line);
          ctx.strokeStyle = "#d71920";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(px, py, 8, 0, Math.PI * 2);
          ctx.stroke();
          const column=index%2;
          const summaryX=12+column*width/2;
          const summaryY=summaryTop+Math.floor(index/2)*58;
          ctx.fillStyle = "#b5141b";
          ctx.textAlign = "left";
          ctx.font = "bold 13px sans-serif";
          ctx.fillText(label + " = " + point.value.toLocaleString("en-US", {maximumFractionDigits:2}), summaryX, summaryY, width/2-24);
          ctx.font = "12px sans-serif";
          ctx.fillText(dateFormat.format(new Date(point.time)) + " น.", summaryX, summaryY+20, width/2-24);
        });
        const ticks = width < 480 ? 2 : 3;
        for (let i = 0; i < ticks; i++) {
          const time = first + (last - first) * i / (ticks - 1);
          ctx.textAlign = i === 0 ? "left" : i === ticks - 1 ? "right" : "center";
          ctx.fillStyle = "#193e43";
          ctx.fillText(dateFormat.format(new Date(time)), x(time), chartTop+plotHeight+34);
        }

        base.width=canvas.width;
        base.height=canvas.height;
        base.getContext("2d").drawImage(canvas,0,0);
        paintCursor();
      }
      canvas.addEventListener("pointerleave",()=>{hoverTime=null;paintCursor();});
      canvas.addEventListener("pointermove", event => {
        const time = first + Math.max(0, Math.min(1, (event.clientX - canvas.getBoundingClientRect().left - left) / plotWidth)) * (last - first);
        let lo = 0, hi = points.length - 1;
        while (lo < hi) {
          const mid = Math.floor((lo + hi) / 2);
          if (points[mid].time < time) lo = mid + 1;
          else hi = mid;
        }
        let point = points[lo];
        if (lo > 0 && time - points[lo - 1].time < point.time - time) point = points[lo - 1];
        if (hoverTime===point.time) return;
        hoverTime=point.time;
        paintCursor();
        detail.replaceChildren();
        const title=document.createElement("strong");
        title.textContent=dateFormat.format(new Date(point.time))+" น.";
        detail.append(title);
        for(const line of series) {
          const match=line.byTime?.get(point.time);
          const item=document.createElement("div");
          item.style.color=line.color;
          item.textContent=line.name+" · "+line.pk+" = "+(match?.value != null ? match.value.toLocaleString("en-US",{maximumFractionDigits:6}) : "ไม่มีค่า");
          if (line.members) item.textContent+=" · มีข้อมูล "+(match?.availableCount ?? 0)+"/"+line.members.length+" จุด";
          detail.append(item);
          if (line.members) {
            // Read the cached member values at this exact timestamp; zero is valid.
            const missing=line.members.filter(member=>!Number.isFinite(loaded.get(member.pk)?.byTime?.get(point.time)?.value));
            if (missing.length) {
              const missingBox=document.createElement("div");
              missingBox.className="missing-measurements";
              missingBox.style.cssText="margin:6px 0 12px;padding:10px 14px;border-left:3px solid #b76539;background:#fff5ed;color:#743d24;border-radius:6px";
              const label=document.createElement("strong");
              label.textContent="ไม่มีข้อมูล ณ เวลานี้ "+missing.length+" จุด";
              const list=document.createElement("ul");
              list.style.cssText="margin:6px 0 0;padding-left:22px;max-height:200px;overflow-y:auto";
              for (const member of missing) {
                const entry=document.createElement("li");
                entry.textContent=member.name+" · PK_POINT "+member.pk;
                list.append(entry);
              }
              missingBox.append(label,list);
              detail.append(missingBox);
            }
          }
        }
      });
      const controls = document.createElement("div");
      controls.className = "fields";
      const save = document.createElement("button");
      save.type = "button";
      save.textContent = "บันทึกกราฟเป็น JPG";
      save.addEventListener("click", () => {
        const createdAt = new Date();
        hoverTime=null;
        const exportWidth = Math.max(1600, canvas.clientWidth);
        draw(exportWidth);
        const exported = document.createElement("canvas");
        const ratio = canvas.width / exportWidth;
        exported.width = canvas.width;
        const energyHeight = energies.length ? 48 + energies.length * 58 : 0;
        const graphOffset = Math.max(88 + series.length * 46, energyHeight) + 16;
        exported.height = canvas.height + (graphOffset + 44) * ratio;
        const ctx = exported.getContext("2d");
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, exported.width, exported.height);
        ctx.save();
        ctx.scale(ratio, ratio);
        ctx.fillStyle = "#193e43";
        ctx.font = "bold 16px sans-serif";
        ctx.fillText(heading.textContent, 12, 28, exportWidth * .45 - 24);
        ctx.font = "13px sans-serif";
        ctx.fillText(range.textContent, 12, 55, exportWidth * .45 - 24);
        series.forEach((line,i)=>{
          ctx.fillStyle=line.color;
          ctx.fillRect(12,72+i*46,22,3);
          ctx.fillText(line.name+" · "+line.pk + (dualAxis.checked ? " · "+(line.axis === "left" ? "แกนซ้าย" : "แกนขวา") : ""),42,78+i*46,exportWidth * .45-54);
          ctx.fillText("Average "+(line.stats.average === null ? "—" : energyNumber(line.stats.average))+" "+line.unit+" · Load Factor "+(line.stats.loadFactor === null ? "—" : energyNumber(line.stats.loadFactor*100)+"%"),42,97+i*46,exportWidth*.45-54);
        });
        if (energies.length) {
          const top = 28;
          const energyX = Math.round(exportWidth * .47);
          const energyWidth = exportWidth - energyX - 20;
          ctx.fillStyle = "#193e43";
          ctx.font = "bold 16px sans-serif";
          ctx.fillText("พลังงานไฟฟ้า (MWh) คำนวณด้วยเทคนิค PCHIP",energyX,top,energyWidth);
          ctx.font = "14px sans-serif";
          energies.forEach((line,i) => {
            ctx.fillStyle = line.color;
            ctx.fillText(line.name+" · "+line.pk,energyX,top+26+i*58,energyWidth);
            ctx.fillStyle = "#193e43";
            const e=line.energy;
            ctx.fillText(e.hours ? "ส่วนบวก "+energyNumber(e.positive)+"   ส่วนลบ "+energyNumber(e.negative)+"   สุทธิ "+energyNumber(e.net) : "ไม่มีช่วงข้อมูล",energyX,top+46+i*58,energyWidth);
          });
        }
        ctx.restore();
        ctx.drawImage(canvas, 0, graphOffset * ratio);
        const stamp = new Intl.DateTimeFormat("th-TH-u-ca-buddhist", {
          timeZone:"Asia/Bangkok", day:"numeric", month:"long", year:"numeric", era:"short"
        }).format(createdAt);
        const clock = new Intl.DateTimeFormat("th-TH", {
          timeZone:"Asia/Bangkok", hour:"2-digit", minute:"2-digit", second:"2-digit", hourCycle:"h23"
        }).format(createdAt);
        ctx.save();
        ctx.scale(ratio, ratio);
        ctx.font = '16px "Noto Sans Thai", Tahoma, sans-serif';
        ctx.fillStyle = "#526269";
        ctx.textAlign = "right";
        ctx.fillText("สร้างภาพเมื่อ " + stamp + " เวลา " + clock + " น.", exportWidth-20, exported.height/ratio-18);
        ctx.restore();
        draw();
        exported.toBlob(blob => {
          if (!blob) return;
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          const monthNames = ["jan", "feb", "mar", "apr", "may", "june", "july", "aug", "sep", "oct", "nov", "dec"];
          const filenameDate = (date, yearSeparator) => {
            const [year, month, day] = date.split("-").map(Number);
            return day + monthNames[month - 1] + yearSeparator + (year + 543);
          };
          const pointNames = series.map(line => line.pk + "_" + line.name.trim().replace(/\s+/g, "_")).join("__");
          const safeName = pointNames.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
          link.download = safeName + "_" + filenameDate(start, "") + "_" + filenameDate(end, "_") + ".jpg";
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 60000);
        }, "image/jpeg", .98);
      });
      const csv = document.createElement("button");
      csv.type = "button";
      csv.textContent = "ส่งออกข้อมูล CSV";
      csv.onclick = () => {
        const blob = new Blob([NccPeriodUtils.rawCsv(series)], {type:"text/csv;charset=utf-8"});
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "NCC_raw_" + start + "_" + end + ".csv";
        link.click();
        setTimeout(() => URL.revokeObjectURL(url),60000);
      };
      const reset = document.createElement("button");
      reset.type = "button";
      reset.textContent = "Reset Graph";
      reset.addEventListener("click", () => {
        invalidate();
        container.replaceChildren();
      });
      const credit = document.createElement("span");
      credit.textContent = "พัฒนา เมื่อ 21 พย 2569 ระดมบุญ";
      credit.style.cssText = "margin-left:auto;align-self:center;text-align:right";
      controls.append(save, csv, reset, credit);
      container.append(controls);
      axisListener = () => {
        for (const select of legend.querySelectorAll("select")) select.hidden = !dualAxis.checked;
        draw();
      };
      dualAxis.addEventListener("change", axisListener);
      observer = new ResizeObserver(draw);
      observer.observe(canvas);
      draw();
      status.textContent = (failures.length ? "อ่านไม่สำเร็จ "+failures.join(", ")+" · " : "") + "แสดง " + valid.length.toLocaleString("th-TH") + " ค่าข้อมูล" + (skipped ? " · ข้าม " + skipped + " รายการที่วันเวลาไม่ถูกต้อง" : "");
      container.scrollIntoView({behavior:"smooth", block:"nearest"});
    } catch {
      if (request === generation) status.textContent = "โหลดข้อมูลไม่สำเร็จ ตรวจสอบการเชื่อมต่อ NCC แล้วกดแสดงข้อมูลอีกครั้ง";
    } finally {
      if (request === generation) {
            clearInterval(timer);
        elapsed.textContent = "ใช้เวลาประมวลผลทั้งหมด " + ((performance.now()-started)/1000).toFixed(1) + " วินาที";
      }
    }
  };
  return {show, invalidate};
}


(() => {
  const chart=createPeriodChart(document.querySelector("#period-chart"),document.querySelector("#period-status"));
  const button=document.querySelector("#period-form button[type=submit]");
  let revision=0;
  let busy=false;
  const form=document.querySelector("#period-form");
  function loading(value) {
    busy=value;
    button.disabled=value;
    button.textContent=value ? "กำลังสร้างกราฟ…" : "แสดงกราฟ";
    form.setAttribute("aria-busy",String(value));
  }
  window.invalidatePeriodChart=()=>{
    revision++;
    chart.invalidate();
    loading(false);
  };
  window.showPeriodCharts=async(points,start,end)=>{
    if(busy) return;
    const run=++revision;
    loading(true);
    try { await chart.show(points,start,end); }
    finally { if(run===revision) loading(false); }
  };
})();
