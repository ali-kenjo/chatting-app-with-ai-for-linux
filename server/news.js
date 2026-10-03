// Live news fetching helper using Google News RSS feeds
const https = require("https");

const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 15000;

function fetchXml(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; FriendsApp/1.0)",
        },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (redirects >= MAX_REDIRECTS) return reject(new Error("Too many redirects from the news feed."));
          return fetchXml(new URL(res.headers.location, url).href, redirects + 1).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Failed to fetch news feed (status ${res.statusCode})`));
        }
        res.setEncoding("utf8"); // keeps characters that span two chunks intact
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
      }
    );
    req.on("timeout", () => req.destroy(new Error("The news feed took too long to answer.")));
    req.on("error", reject);
  });
}

// &amp; last, so "&amp;quot;" stays "&quot;" instead of becoming a quote mark
const decodeEntities = (text) => text.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

function parseRss(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null && items.length < 10) {
    const itemXml = match[1];
    const titleMatch = itemXml.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || itemXml.match(/<title>(.*?)<\/title>/);
    const linkMatch = itemXml.match(/<link>(.*?)<\/link>/);
    const pubDateMatch = itemXml.match(/<pubDate>(.*?)<\/pubDate>/);
    const sourceMatch = itemXml.match(/<source[^>]*>(.*?)<\/source>/);

    const title = titleMatch ? decodeEntities(titleMatch[1]) : "Untitled";
    const link = linkMatch ? linkMatch[1] : "";
    const pubDate = pubDateMatch ? pubDateMatch[1] : "";
    const source = sourceMatch ? sourceMatch[1] : "News";

    items.push({ title, link, pubDate, source });
  }
  return items;
}

async function getNews(query = "") {
  query = String(query ?? "");
  try {
    const encoded = encodeURIComponent(query.trim());
    const url = query.trim()
      ? `https://news.google.com/rss/search?q=${encoded}&hl=en-US&gl=US&ceid=US:en`
      : "https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en";

    const xml = await fetchXml(url);
    const items = parseRss(xml);
    return {
      query: query || "Top Stories",
      articles: items,
    };
  } catch (err) {
    return {
      query: query || "Top Stories",
      articles: [],
      error: err.message,
    };
  }
}

module.exports = { getNews };
