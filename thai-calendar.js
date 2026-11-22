(() => {
  const dialog = document.querySelector("#thai-calendar");
  const title = dialog.querySelector("#calendar-title");
  const grid = dialog.querySelector(".calendar-grid");
  const today = dialog.querySelector("#today");
  const fullDate = new Intl.DateTimeFormat("th-TH-u-ca-buddhist", {
    year: "numeric", month: "long", day: "numeric", timeZone: "UTC"
  });
  const months = "มกราคม กุมภาพันธ์ มีนาคม เมษายน พฤษภาคม มิถุนายน กรกฎาคม สิงหาคม กันยายน ตุลาคม พฤศจิกายน ธันวาคม".split(" ");
  const shortMonths = "ม.ค. ก.พ. มี.ค. เม.ย. พ.ค. มิ.ย. ก.ค. ส.ค. ก.ย. ต.ค. พ.ย. ธ.ค.".split(" ");
  const bangkokToday = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Bangkok" }).format(new Date());
  const iso = date => date.toISOString().slice(0, 10);
  const utc = (year, month, day) => new Date(Date.UTC(year, month, day));
  let trigger, field, year, month, view;
  const minimum = () => field.id === "end" ? document.querySelector("#start").value : "";

  function display(input, value) {
    input.value = value;
    document.querySelector("#" + input.id + "-display").textContent =
      value ? fullDate.format(new Date(value)) : "เลือกวันที่";
  }

  function choose(value) {
    if (value && value < minimum()) return;
    display(field, value);
    const end = document.querySelector("#end");
    if (field.id === "start" && end.value && end.value < value) display(end, "");
    if (field.id === "start" || field.id === "end") {
      document.querySelector("#date-preset").value = "";
      window.invalidatePeriodChart?.();
    }
    dialog.close();
  }

  function option(label, selected, action, disabled = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.disabled = disabled;
    button.setAttribute("aria-pressed", String(selected));
    button.onclick = action;
    grid.append(button);
    return button;
  }

  function render() {
    grid.replaceChildren();
    grid.classList.toggle("choices", view !== "day");
    const buddhist = year + 543;
    const decade = Math.floor(buddhist / 10) * 10;
    today.disabled = bangkokToday() < minimum();
    if (view === "year") {
      title.textContent = decade + "–" + (decade + 9);
      for (let y = decade - 1; y <= decade + 10; y++) {
        option(y, y === buddhist, () => { year = y - 543; view = "month"; render(); });
      }
    } else if (view === "month") {
      title.textContent = buddhist;
      shortMonths.forEach((name, i) => option(name, i === month, () => { month = i; view = "day"; render(); }));
    } else {
      title.textContent = months[month] + " " + buddhist;
      for (const name of ["อา","จ","อ","พ","พฤ","ศ","ส"]) {
        grid.appendChild(document.createElement("strong")).textContent = name;
      }
      const first = utc(year, month, 1).getUTCDay();
      for (let i = 0; i < 42; i++) {
        const date = utc(year, month, i - first + 1);
        const value = iso(date);
        const day = option(date.getUTCDate(), value === field.value, () => choose(value), value < minimum());
        day.classList.toggle("outside", date.getUTCMonth() !== month);
        day.setAttribute("aria-label", fullDate.format(date));
      }
    }
  }

  function move(step) {
    if (view === "day") {
      const date = utc(year, month + step, 1);
      year = date.getUTCFullYear();
      month = date.getUTCMonth();
    } else year += step * (view === "year" ? 10 : 1);
    render();
  }

  function position() {
    const box = trigger.getBoundingClientRect();
    dialog.style.left = Math.max(4, Math.min(box.left, innerWidth - dialog.offsetWidth - 4)) + "px";
    const below = box.bottom + 4;
    dialog.style.top = Math.max(4, below + dialog.offsetHeight <= innerHeight ? below : Math.min(box.top - dialog.offsetHeight - 4, innerHeight - dialog.offsetHeight - 4)) + "px";
  }
  document.querySelectorAll(".date-trigger").forEach(button => button.addEventListener("click", () => {
    trigger = button;
    field = document.getElementById(button.dataset.field);
    const initial = field.value || [minimum(), bangkokToday()].sort().pop();
    [year, month] = initial.split("-").map(Number);
    month--;
    view = "day";
    render();
    dialog.showModal();
    position();
    (grid.querySelector('[aria-pressed="true"]') || title).focus();
  }));
  title.onclick = () => { view = view === "day" ? "month" : "year"; render(); };
  dialog.querySelector("#previous").onclick = () => move(-1);
  dialog.querySelector("#next").onclick = () => move(1);
  dialog.querySelector("#clear-date").onclick = () => choose("");
  today.onclick = () => choose(bangkokToday());
  window.addEventListener("resize", () => { if (dialog.open) position(); });
  dialog.addEventListener("click", event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  });
})();
