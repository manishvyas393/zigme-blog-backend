import mongoose from "mongoose";
import { connectDb } from "../db.js";
import { BlogVersionModel } from "../models/blogVersion.js";

interface GroupSummary {
  groupId: string;
  firstId: string;
  count: number;
  revisions: number[];
  titles: string[];
  site: string;
}

async function main(): Promise<void> {
  await connectDb();

  const documents = await BlogVersionModel.find({})
    .sort({ blog_group_id: 1, revision: 1, created_at: 1, _id: 1 })
    .lean();

  const groups = new Map<string, typeof documents>();

  for (const document of documents) {
    const key = document.blog_group_id || String(document._id);
    const current = groups.get(key) || [];
    current.push(document);
    groups.set(key, current);
  }

  const summaries: GroupSummary[] = [];

  for (const [, group] of groups) {
    if (group.length === 0) {
      continue;
    }

    const first = group[0];
    const firstId = String(first._id);

    await BlogVersionModel.updateMany(
      { _id: { $in: group.map((item) => item._id) } },
      { $set: { blog_group_id: firstId } }
    );

    summaries.push({
      groupId: firstId,
      firstId,
      count: group.length,
      revisions: group.map((item) => item.revision),
      titles: group.map((item) => item.title),
      site: first.site
    });
  }

  console.log(JSON.stringify(summaries, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error("Grouping blogs by first _id failed.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
