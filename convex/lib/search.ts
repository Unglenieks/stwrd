// Denormalized catalog search text (spec §17).
//
// A Convex search index covers a single field, but the catalog searches title +
// description + tags. We maintain this concatenation on every write that changes
// those fields (contribute, update, tag rename/merge).
export function buildSearchText(parts: {
  title: string;
  description: string;
  tags: string[];
}): string {
  return [parts.title, parts.description, ...parts.tags].join(" ").toLowerCase();
}
