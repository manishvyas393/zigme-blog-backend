import mongoose from "mongoose";
import { connectDb } from "../db.js";
import { BlogVersionModel } from "../models/blogVersion.js";

async function dropIndexIfExists(name: string): Promise<void> {
  const indexes = await BlogVersionModel.collection.indexes();

  if (!indexes.some((index) => index.name === name)) {
    return;
  }

  await BlogVersionModel.collection.dropIndex(name);
}

async function migrate(): Promise<void> {
  await connectDb();

  const copyResult = await BlogVersionModel.collection.updateMany(
    {},
    [
      {
        $set: {
          blog_group_id: { $ifNull: ["$blog_group_id", "$blogGroupId"] },
          search_query: { $ifNull: ["$search_query", "$searchQuery"] },
          html_content: { $ifNull: ["$html_content", "$htmlContent"] },
          generation_notes: { $ifNull: ["$generation_notes", "$generationNotes"] },
          created_at: { $ifNull: ["$created_at", "$createdAt"] },
          updated_at: { $ifNull: ["$updated_at", "$updatedAt"] },
          selected_news: {
            $cond: [
              { $ne: ["$selected_news", null] },
              "$selected_news",
              {
                $cond: [
                  { $ne: ["$selectedNews", null] },
                  {
                    title: "$selectedNews.title",
                    link: "$selectedNews.link",
                    snippet: "$selectedNews.snippet",
                    source_name: "$selectedNews.sourceName",
                    published_at: "$selectedNews.publishedAt"
                  },
                  null
                ]
              }
            ]
          },
          source_results: {
            $cond: [
              { $isArray: "$source_results" },
              "$source_results",
              {
                $cond: [
                  { $isArray: "$sourceResults" },
                  {
                    $map: {
                      input: "$sourceResults",
                      as: "source",
                      in: {
                        title: "$$source.title",
                        link: "$$source.link",
                        snippet: "$$source.snippet"
                      }
                    }
                  },
                  []
                ]
              }
            ]
          }
        }
      }
    ]
  );

  await dropIndexIfExists("blogGroupId_1");

  const unsetResult = await BlogVersionModel.collection.updateMany(
    {},
    [
      {
        $unset: [
          "blogGroupId",
          "searchQuery",
          "htmlContent",
          "selectedNews",
          "sourceResults",
          "generationNotes",
          "createdAt",
          "updatedAt"
        ]
      }
    ]
  );

  await BlogVersionModel.collection.createIndex({ blog_group_id: 1 }, { name: "blog_group_id_1" });

  console.log(
    `Migration complete. Copied ${copyResult.modifiedCount} docs and cleaned ${unsetResult.modifiedCount} docs.`
  );
}

migrate()
  .catch((error: unknown) => {
    console.error("Snake case migration failed.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
