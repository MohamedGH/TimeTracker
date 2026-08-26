let dayChart;
let hourChart;

export function destroyCharts() {
  dayChart?.destroy();
  hourChart?.destroy();
  dayChart = undefined;
  hourChart = undefined;
}

export function renderCharts({ dayCanvas, hourCanvas, entries }) {
  destroyCharts();
  if (!window.Chart || !dayCanvas || !hourCanvas) return;

  const byDay = new Map();
  const byHour = Array.from({ length: 24 }, () => 0);
  for (const entry of entries) {
    byDay.set(entry.date, (byDay.get(entry.date) || 0) + entry.mins);
    const hour = Number(String(entry.start).slice(0, 2));
    if (Number.isInteger(hour) && hour >= 0 && hour < 24) byHour[hour] += entry.mins;
  }

  const dayLabels = [...byDay.keys()].sort();
  dayChart = new window.Chart(dayCanvas, {
    type: 'bar',
    data: { labels: dayLabels, datasets: [{ label: 'Minutes', data: dayLabels.map(d => byDay.get(d)) }] },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
  });

  hourChart = new window.Chart(hourCanvas, {
    type: 'line',
    data: { labels: byHour.map((_, i) => `${String(i).padStart(2, '0')}h`), datasets: [{ label: 'Minutes', data: byHour, tension: 0.25 }] },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
  });
}
