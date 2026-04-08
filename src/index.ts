import cors from "cors";
import express from "express";
import { config } from "./config.js";
import { connectDb } from "./db.js";
import { blogRouter } from "./routes/blogRoutes.js";

const app = express();

app.use(
  cors({
    origin: config.clientUrl
  })
);
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/blogs", blogRouter);

connectDb()
  .then(() => {
    app.listen(config.port, () => {
      console.log(`Server running on http://localhost:${config.port}`);
    });
  })
  .catch((error: unknown) => {
    console.error("Failed to start server", error);
    process.exit(1);
  });

