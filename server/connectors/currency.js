// Exchange rates from the European Central Bank, via Frankfurter (frankfurter.dev). No account.
const { api } = require("../net");
const { str, num, fn } = require("./schema");

async function convert(amount, from, to) {
  const a = Number(amount);
  const f = String(from || "").trim().toUpperCase();
  const t = String(to || "").trim().toUpperCase();
  if (!Number.isFinite(a)) throw new Error("How much should be converted?");
  if (!/^[A-Z]{3}$/.test(f) || !/^[A-Z]{3}$/.test(t)) throw new Error("Use three-letter currency codes, like EUR, USD or GBP.");
  if (f === t) return { amount: a, from: f, to: t, result: a, rate: 1 };
  const data = await api(`https://api.frankfurter.dev/v1/latest?base=${f}&symbols=${t}`, { what: "The exchange rate service" });
  const rate = data.rates?.[t];
  if (!rate) throw new Error(`No exchange rate from ${f} to ${t}.`);
  return { amount: a, from: f, to: t, rate, result: Math.round(a * rate * 100) / 100, date: data.date };
}

module.exports = {
  id: "currency",
  name: "Currency",
  icon: "💱",
  description: "Convert money between currencies at today's exchange rate (European Central Bank). No account.",
  link: "https://frankfurter.dev",
  online: true,
  defaultOn: true,
  fields: [],
  prompt: "`convert_currency` converts money at today's exchange rate.",
  tools: [
    {
      decl: fn("convert_currency", "Convert an amount of money between currencies at today's rate.", { amount: num("The amount"), from: str("Currency code, e.g. EUR"), to: str("Currency code, e.g. USD") }),
      async run(args, { ctx }) {
        ctx.onActivity?.(`Converting ${args.amount} ${String(args.from).toUpperCase()} to ${String(args.to).toUpperCase()}`);
        return { ok: true, ...(await convert(args.amount, args.from, args.to)) };
      },
    },
  ],
  async test() {
    const r = await convert(1, "EUR", "USD");
    return `1 EUR = ${r.rate} USD (${r.date}).`;
  },
  convert,
};
