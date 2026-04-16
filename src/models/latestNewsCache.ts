import mongoose, { HydratedDocument, Model } from "mongoose";
import type { SelectedNews } from "./blogVersion.js";

export interface LatestNewsCache {
  cache_key: string;
  topic: string;
  start_date: string;
  end_date: string;
  hiring_items: SelectedNews[];
  talent_items: SelectedNews[];
  items: SelectedNews[];
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
}

const selectedNewsSchema = new mongoose.Schema<SelectedNews>(
  {
    title: { type: String, required: true },
    link: { type: String, required: true },
    snippet: { type: String, default: "" },
    sourceName: { type: String, default: "" },
    publishedAt: { type: String, default: "" },
    imageUrl: { type: String, default: "" }
  },
  { _id: false }
);

const latestNewsCacheSchema = new mongoose.Schema<LatestNewsCache>(
  {
    cache_key: { type: String, required: true, unique: true, index: true },
    topic: { type: String, required: true },
    start_date: { type: String, required: true },
    end_date: { type: String, required: true },
    hiring_items: { type: [selectedNewsSchema], default: [] },
    talent_items: { type: [selectedNewsSchema], default: [] },
    items: { type: [selectedNewsSchema], default: [] },
    expires_at: { type: Date, required: true, index: { expires: 0 } }
  },
  {
    timestamps: {
      createdAt: "created_at",
      updatedAt: "updated_at"
    }
  }
);

export type LatestNewsCacheDocument = HydratedDocument<LatestNewsCache>;

export const LatestNewsCacheModel = mongoose.model<LatestNewsCache>(
  "LatestNewsCache",
  latestNewsCacheSchema
) as Model<LatestNewsCache>;
