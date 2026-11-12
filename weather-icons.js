// Weather icons + labels for WMO weather codes (as returned by Open-Meteo). Shared by the notch and Settings.
(function () {
  const cloud = (fill = '#c9cdd6', y = 0) =>
    `<path d="M7.2 ${18.5 + y}h9.6a4.2 4.2 0 0 0 .5-8.4 5.6 5.6 0 0 0-10.8 1.6 3.4 3.4 0 0 0 .7 6.8z" fill="${fill}"/>`;
  const sun = (cx = 12, cy = 12, r = 4.6) => {
    let rays = '';
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4, x1 = cx + Math.cos(a) * (r + 2.2), y1 = cy + Math.sin(a) * (r + 2.2);
      const x2 = cx + Math.cos(a) * (r + 4.2), y2 = cy + Math.sin(a) * (r + 4.2);
      rays += `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}"/>`;
    }
    return `<g stroke="#ffcc33" stroke-width="1.8" stroke-linecap="round">${rays}</g><circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffcc33"/>`;
  };
  const moon = (s = 1, dx = 0, dy = 0) =>
    `<path transform="translate(${dx} ${dy}) scale(${s})" d="M18.5 14.6A7.5 7.5 0 0 1 9.4 5.5a.5.5 0 0 0-.7-.6 8.5 8.5 0 1 0 10.4 10.4.5.5 0 0 0-.6-.7z" fill="#e4e7f5"/>`;
  const svg = (body) => `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

  function kind(code) {
    if (code === 0) return 'clear';
    if (code === 1 || code === 2) return 'partly';
    if (code === 3) return 'cloudy';
    if (code === 45 || code === 48) return 'fog';
    if (code >= 51 && code <= 57) return 'drizzle';
    if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
    if (code >= 95) return 'storm';
    return 'cloudy';
  }

  const LABELS = { clear: 'Clear', partly: 'Partly cloudy', cloudy: 'Cloudy', fog: 'Fog', drizzle: 'Drizzle', rain: 'Rain', snow: 'Snow', storm: 'Thunderstorm' };

  function icon(code, isDay = true) {
    switch (kind(code)) {
      case 'clear': return svg(isDay ? sun() : moon(1.05, -0.6, -0.4));
      case 'partly': return svg((isDay ? sun(9, 9, 3.6) : moon(0.7, 1.2, 1.4)) + cloud('#d9dde6', 1));
      case 'cloudy': return svg(cloud('#c9cdd6', -1));
      case 'fog': return svg(cloud('#aeb4c0', -3) + '<g stroke="#c9cdd6" stroke-width="1.6" stroke-linecap="round"><path d="M5 19.5h14M7 22h10"/></g>');
      case 'drizzle': return svg(cloud('#b9bfcb', -3) + '<g fill="#5ab4ff"><circle cx="9" cy="19.5" r="1"/><circle cx="13" cy="21" r="1"/><circle cx="16" cy="19" r="1"/></g>');
      case 'rain': return svg(cloud('#aeb4c0', -3) + '<g stroke="#4aa8ff" stroke-width="1.7" stroke-linecap="round"><path d="M8.5 18.5l-1 3M12.5 18.5l-1 3M16.5 18.5l-1 3"/></g>');
      case 'snow': return svg(cloud('#c9cdd6', -3) + '<g fill="#ffffff"><circle cx="8.5" cy="20" r="1.2"/><circle cx="12.5" cy="21.5" r="1.2"/><circle cx="16.5" cy="20" r="1.2"/></g>');
      case 'storm': return svg(cloud('#9aa1ae', -3) + '<path d="M12.8 15.5l-3 4.2h2.4l-1 3.8 3.6-5h-2.5l1.2-3z" fill="#ffcc33"/>');
      default: return svg(cloud());
    }
  }

  window.WeatherIcons = { icon, label: (code) => LABELS[kind(code)] || 'Weather' };
})();
