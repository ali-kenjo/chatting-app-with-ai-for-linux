// Home Assistant: your lights, switches, heating, media and scenes, by voice
// ("Atlas, lights off"). Uses your Home Assistant address and a long-lived
// access token. Locks, alarms, garage doors and covers always ask first;
// everything else asks only when you want it to. Works in Private mode when
// Home Assistant is on your own network.
const { api, isPrivateAddress } = require("../net");
const { str, num, oneOf, fn } = require("./schema");

const CONTROLLABLE = ["light", "switch", "fan", "climate", "cover", "media_player", "scene", "script", "lock", "input_boolean", "vacuum", "button", "alarm_control_panel", "humidifier", "water_heater"];
const READABLE = [...CONTROLLABLE, "sensor", "binary_sensor", "weather", "person", "device_tracker"];
const RISKY = ["lock", "alarm_control_panel", "cover"];
const ACTIONS = ["turn_on", "turn_off", "toggle", "open", "close", "lock", "unlock", "activate", "set_temperature", "play_pause", "volume_set"];

const base = (cfg) => String(cfg.url || "").replace(/\/+$/, "");

function ha(cfg, path, options = {}) {
  return api(`${base(cfg)}/api${path}`, { ...options, headers: { Authorization: `Bearer ${cfg.token}`, ...(options.headers || {}) }, what: "Home Assistant" });
}

// The service to call for an action on an entity
function serviceFor(entityId, action, args = {}) {
  const domain = entityId.split(".")[0];
  if (!CONTROLLABLE.includes(domain)) throw new Error(`${entityId} can't be controlled from here.`);
  const data = { entity_id: entityId };
  let service = action;
  if (domain === "cover") service = { open: "open_cover", close: "close_cover", turn_on: "open_cover", turn_off: "close_cover", toggle: "toggle" }[action];
  else if (domain === "lock") service = { lock: "lock", unlock: "unlock", turn_on: "lock", turn_off: "unlock" }[action];
  else if (domain === "scene" || domain === "script") service = "turn_on";
  else if (domain === "button") service = "press";
  else if (action === "set_temperature") {
    if (!Number.isFinite(Number(args.value))) throw new Error("Which temperature?");
    data.temperature = Number(args.value);
  } else if (action === "play_pause") service = "media_play_pause";
  else if (action === "volume_set") {
    data.volume_level = Math.min(1, Math.max(0, Number(args.value) / 100));
    service = "volume_set";
  } else if (action === "activate") service = "turn_on";
  if (domain === "light" && service === "turn_on" && Number.isFinite(Number(args.value))) data.brightness_pct = Math.min(100, Math.max(1, Number(args.value)));
  if (!service) throw new Error(`"${action}" doesn't work for ${domain}.`);
  return { domain: domain === "scene" || domain === "script" || domain === "button" ? domain : domain, service, data };
}

module.exports = {
  id: "homeassistant",
  name: "Home Assistant",
  icon: "🏠",
  description: "Control your smart home by talking: lights, switches, heating, blinds, media and scenes, and read your sensors.",
  help: "In Home Assistant open your profile → Security → Long-lived access tokens → Create token. The address is the one you open Home Assistant with, like http://homeassistant.local:8123.",
  link: "https://www.home-assistant.io/docs/authentication/#your-account-profile",
  online: true,
  private: true,
  localNetwork: (cfg) => {
    try {
      const host = new URL(cfg.url).hostname.replace(/^\[|\]$/g, "");
      return host === "localhost" || host.endsWith(".local") || isPrivateAddress(host);
    } catch {
      return false;
    }
  },
  fields: [
    { key: "url", label: "Address", placeholder: "http://homeassistant.local:8123", required: true, pattern: "^https?://", patternHelp: "start the address with http:// or https://" },
    { key: "token", label: "Long-lived access token", placeholder: "eyJ…", secret: true, required: true },
    { key: "confirm", label: "Ask before switching things", type: "select", options: [["risky", "Only locks, alarms and covers"], ["all", "Every time"]], default: "risky" },
  ],
  prompt: "Home Assistant (the user's smart home): `home_devices` lists devices and sensors with their state; `home_control` switches them. Confirm what you did in a few words.",
  tools: [
    {
      decl: fn("home_devices", "The user's smart home devices and sensors, with their current state.", { search: str("Optional: only those whose name or id contains this, e.g. 'living room' or 'light'") }, []),
      async run(args, { cfg, ctx }) {
        ctx.onActivity?.("Looking at your smart home");
        const states = await ha(cfg, "/states");
        const q = String(args.search || "").toLowerCase();
        const items = states
          .filter((s) => READABLE.includes(s.entity_id.split(".")[0]))
          .map((s) => ({ id: s.entity_id, name: s.attributes?.friendly_name || s.entity_id, state: s.state, unit: s.attributes?.unit_of_measurement, brightness: s.attributes?.brightness, temperature: s.attributes?.temperature ?? s.attributes?.current_temperature }))
          .filter((s) => !q || `${s.id} ${s.name}`.toLowerCase().includes(q));
        return { ok: true, devices: items.slice(0, 80), more: items.length > 80 };
      },
    },
    {
      decl: fn("home_control", "Switch or set a smart home device.", { entity_id: str("The device's id from home_devices, e.g. light.living_room"), action: oneOf(ACTIONS, "What to do"), value: num("For a light: brightness 1-100; for heating: temperature; for volume: 0-100") }, ["entity_id", "action"]),
      confirm: (args, cfg) => (cfg.confirm === "all" || RISKY.includes(String(args.entity_id).split(".")[0]) ? `${String(args.action).replace(/_/g, " ")} ${args.entity_id}` : null),
      async run(args, { cfg, ctx }) {
        const { domain, service, data } = serviceFor(String(args.entity_id || ""), args.action, args);
        await ha(cfg, `/services/${domain}/${service}`, { method: "POST", body: data });
        ctx.onActivity?.(`Home: ${service.replace(/_/g, " ")} ${args.entity_id}`);
        return { ok: true };
      },
    },
  ],
  async test(cfg) {
    const info = await ha(cfg, "/config");
    return `Connected to ${info.location_name || "Home Assistant"} (${info.version || "?"}).`;
  },
  serviceFor,
};
