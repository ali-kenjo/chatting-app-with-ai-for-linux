// Weather from Open-Meteo (open-meteo.com): free, no account, no key.
const { api } = require("../net");
const { str, num, fn } = require("./schema");

const CODES = {
  0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast", 45: "fog", 48: "freezing fog",
  51: "light drizzle", 53: "drizzle", 55: "heavy drizzle", 56: "freezing drizzle", 57: "heavy freezing drizzle",
  61: "light rain", 63: "rain", 65: "heavy rain", 66: "freezing rain", 67: "heavy freezing rain",
  71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow grains", 80: "light showers", 81: "showers", 82: "violent showers",
  85: "snow showers", 86: "heavy snow showers", 95: "thunderstorm", 96: "thunderstorm with hail", 99: "thunderstorm with heavy hail",
};

async function locate(place) {
  const q = String(place || "").trim();
  if (!q) throw new Error("Which place? Set your town in Settings → Connected Apps → Weather, or name one.");
  // "Berlin, Germany" → the name and a hint for picking the right one
  const [name, hint] = q.split(",").map((x) => x.trim());
  const data = await api(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=5&language=en&format=json`, { what: "The weather service" });
  const results = data.results || [];
  const pick = (hint && results.find((r) => [r.country, r.country_code, r.admin1].some((x) => x && x.toLowerCase().startsWith(hint.toLowerCase())))) || results[0];
  if (!pick) throw new Error(`Couldn't find a place called "${q}".`);
  return { name: [pick.name, pick.admin1, pick.country].filter(Boolean).join(", "), latitude: pick.latitude, longitude: pick.longitude };
}

async function forecast(place, { days = 3, units = "metric" } = {}) {
  const where = await locate(place);
  const n = Math.min(7, Math.max(1, Math.round(Number(days)) || 3));
  const imperial = units === "imperial";
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${where.latitude}&longitude=${where.longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,precipitation&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset&timezone=auto&forecast_days=${n}${imperial ? "&temperature_unit=fahrenheit&wind_speed_unit=mph" : ""}`;
  const d = await api(url, { what: "The weather service" });
  const unit = imperial ? "°F" : "°C";
  return {
    place: where.name,
    now: d.current && {
      condition: CODES[d.current.weather_code] || "unknown",
      temperature: `${Math.round(d.current.temperature_2m)}${unit}`,
      feelsLike: `${Math.round(d.current.apparent_temperature)}${unit}`,
      humidity: `${d.current.relative_humidity_2m}%`,
      wind: `${Math.round(d.current.wind_speed_10m)} ${imperial ? "mph" : "km/h"}`,
    },
    days: (d.daily?.time || []).map((day, i) => ({
      date: day,
      condition: CODES[d.daily.weather_code[i]] || "unknown",
      high: `${Math.round(d.daily.temperature_2m_max[i])}${unit}`,
      low: `${Math.round(d.daily.temperature_2m_min[i])}${unit}`,
      rainChance: `${d.daily.precipitation_probability_max?.[i] ?? 0}%`,
      sunrise: d.daily.sunrise?.[i]?.slice(11),
      sunset: d.daily.sunset?.[i]?.slice(11),
    })),
  };
}

module.exports = {
  id: "weather",
  name: "Weather",
  icon: "⛅",
  description: "Current weather and the forecast for any place. Free, no account.",
  link: "https://open-meteo.com",
  online: true,
  defaultOn: true,
  fields: [
    { key: "place", label: "Your town", placeholder: "e.g. Berlin, Germany", help: "Used when you don't name a place, and in the daily briefing" },
    { key: "units", label: "Units", type: "select", options: [["metric", "°C, km/h"], ["imperial", "°F, mph"]], default: "metric" },
  ],
  prompt: "`get_weather` gives the current weather and forecast for a place (their town when none is named).",
  tools: [
    {
      decl: fn("get_weather", "The current weather and the forecast (up to 7 days) for a place.", { place: str("Town or city, e.g. 'Hamburg' or 'Paris, France'. Leave out for the user's town."), days: num("How many days of forecast (1-7, default 3)") }, []),
      async run(args, { cfg, ctx }) {
        ctx.onActivity?.(`Checking the weather${args.place ? ` in ${args.place}` : ""}`);
        return { ok: true, weather: await forecast(args.place || cfg.place, { days: args.days, units: cfg.units }) };
      },
    },
  ],
  async briefing({ cfg, out }) {
    if (!cfg.place) return;
    const w = await forecast(cfg.place, { days: 1, units: cfg.units });
    out.weather = { place: w.place, now: w.now, today: w.days[0] };
  },
  async test(cfg) {
    const w = await forecast(cfg.place || "Berlin", { days: 1, units: cfg.units });
    return `${w.place}: ${w.now.condition}, ${w.now.temperature}.`;
  },
  forecast,
  locate,
};
