import dns from "node:dns";
import mongoose from "mongoose";
import { config } from "./config.js";

export async function connectDb(): Promise<void> {
  if (config.dnsServers.length > 0) {
    dns.setServers(config.dnsServers);
  }

  await mongoose.connect(config.mongodbUri);
}

