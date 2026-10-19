import "dotenv/config";
import express from "express";
import { getBooks, parsePagination, parseSearch } from "./books";

const app = express();
const port = Number(process.env.PORT) || 3000;

app.get("/api/books", async (req, res) => {
  try {
    const pagination = parsePagination(req.query);
    const search = parseSearch(req.query);
    const result = await getBooks({ ...pagination, search });
    res.json(result);
  } catch (error) {
    console.error("Failed to export books:", error);
    res.status(500).json({ error: "Failed to fetch books" });
  }
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(port, () => {
  console.log(`Books API listening on http://localhost:${port}`);
});
