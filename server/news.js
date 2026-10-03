// Live news fetching helper using Google News RSS feeds
const https = require("https");

function fetchXml(url) {
  return new Promise((resolve, reject) => {
    https.get(
      url,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; FriendsApp/1.0)",
        },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchXml(res.headers.location).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Failed to fetch news feed (status ${res.statusCode})`));
        }
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
      }
    ).on("error", reject);
  });
}

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

    const title = titleMatch ? titleMatch[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'") : "Untitled";
    const link = linkMatch ? linkMatch[1] : "";
    const pubDate = pubDateMatch ? pubDateMatch[1] : "";
    const source = sourceMatch ? sourceMatch[1] : "News";

    items.push({ title, link, pubDate, source });
  }
  return items;
}

async function getNews(query = "") {
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
