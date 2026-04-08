import dotenv from "dotenv";

dotenv.config();

const required = ["MONGODB_URI"] as const;

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

export interface AppConfig {
  port: number;
  clientUrl: string;
  clientUrls: string[];
  mongodbUri: string;
  dnsServers: string[];
  openAiApiKey: string;
  newsModel: string;
  blogModel: string;
  postmarkServerToken: string;
  mailFrom: string;
  approvalEmail: string;
}

const clientUrls = (process.env.CLIENT_URL || "http://localhost:5173")
  .split(",")
  .map((value) => value.trim().replace(/\/+$/, ""))
  .filter(Boolean);

export const config: AppConfig = {
  port: Number(process.env.PORT || 4000),
  clientUrl: clientUrls[0] || "http://localhost:5173",
  clientUrls,
  mongodbUri: process.env.MONGODB_URI as string,
  dnsServers: (process.env.DNS_SERVERS || "8.8.8.8,1.1.1.1")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  openAiApiKey: process.env.OPENAI_API_KEY || "",
  newsModel: process.env.NEWS_MODEL || "gpt-4.1-mini",
  blogModel: process.env.BLOG_MODEL || "gpt-4.1",
  postmarkServerToken: process.env.POSTMARK_SERVER_TOKEN || "",
  mailFrom: process.env.MAIL_FROM || "no-reply@zigme.in",
  approvalEmail: process.env.APPROVAL_EMAIL || "manish@zigme.in"
};
