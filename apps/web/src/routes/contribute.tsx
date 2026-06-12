import { useConvexAuth, useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { api } from "@cvx/api";
import type { Id } from "@cvx/dataModel";
import {
  CONDITION_RUBRIC,
  EXCHANGE_MODES,
  PHOTOS_MAX_PER_ENTRY,
  TITLE_MAX,
} from "@lot/shared";
import { Button, Card, FieldError, Input, Label, Textarea } from "~/components/ui";
import { processImage, uploadToConvex } from "~/lib/imageUpload";

export const Route = createFileRoute("/contribute")({
  component: Contribute,
});

function Contribute() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useConvexAuth();
  useEffect(() => {
    if (!isLoading && !isAuthenticated) void navigate({ to: "/login" });
  }, [isLoading, isAuthenticated, navigate]);

  if (isLoading || !isAuthenticated) return null;
  return <ContributeForm />;
}

function ContributeForm() {
  const navigate = useNavigate();
  const categories = useQuery(api.categories.tree, {});
  const generateUploadUrl = useMutation(api.storage.generateUploadUrl);
  const contribute = useAction(api.items.contribute);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [condition, setCondition] = useState(4);
  const [exchangeMode, setExchangeMode] = useState<(typeof EXCHANGE_MODES)[number]>("reveal_contact");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Render the flat tree as an indented picker.
  const options = useMemo(() => {
    if (!categories) return [];
    const byParent = new Map<string | null, typeof categories>();
    for (const c of categories) {
      const key = c.parentId;
      byParent.set(key, [...(byParent.get(key) ?? []), c]);
    }
    const out: { id: string; label: string }[] = [];
    const walk = (parent: string | null, depth: number) => {
      for (const c of byParent.get(parent) ?? []) {
        out.push({ id: c._id, label: `${"  ".repeat(depth)}${c.name}` });
        walk(c._id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [categories]);

  const rubric = CONDITION_RUBRIC[condition];

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!categoryId) return setError("Choose a category.");
    if (files.length === 0) return setError("Add at least one photo.");
    setBusy(true);
    try {
      // Process + upload each photo (downscale, strip EXIF, then upload).
      const photoIds: string[] = [];
      for (const file of files.slice(0, PHOTOS_MAX_PER_ENTRY)) {
        const blob = await processImage(file);
        const url = await generateUploadUrl();
        photoIds.push(await uploadToConvex(url, blob));
      }
      const tags = tagsText
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      await contribute({
        title,
        description,
        categoryId: categoryId as Id<"categories">,
        tags,
        attributes: [],
        condition,
        photoIds: photoIds as Id<"_storage">[],
        exchangeMode,
      });
      await navigate({ to: "/" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the item.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="mb-1 text-2xl font-semibold">Contribute an item</h1>
      <p className="mb-6 text-sm text-slate-500">Share something for the community to borrow.</p>
      <Card>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              maxLength={TITLE_MAX}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="category">Category</Label>
            <select
              id="category"
              className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              required
            >
              <option value="" disabled>
                {categories === undefined ? "Loading…" : "Select a category"}
              </option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="tags">Tags (comma-separated)</Label>
            <Input
              id="tags"
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              placeholder="drill, cordless"
            />
          </div>
          <div>
            <Label htmlFor="condition">
              Condition: {condition} — {rubric?.label}
            </Label>
            <input
              id="condition"
              type="range"
              min={1}
              max={5}
              step={1}
              value={condition}
              onChange={(e) => setCondition(Number(e.target.value))}
              className="w-full"
            />
            <p className="mt-1 text-xs text-slate-500">{rubric?.detail}</p>
          </div>
          <div>
            <Label htmlFor="exchange">Exchange preference</Label>
            <select
              id="exchange"
              className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
              value={exchangeMode}
              onChange={(e) => setExchangeMode(e.target.value as (typeof EXCHANGE_MODES)[number])}
            >
              <option value="reveal_contact">Reveal my contact info</option>
              <option value="branch">Drop at a branch</option>
            </select>
          </div>
          <div>
            <Label htmlFor="photos">Photos</Label>
            <input
              id="photos"
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              className="block w-full text-sm"
            />
            {files.length > 0 && (
              <p className="mt-1 text-xs text-slate-500">
                {files.length} photo{files.length > 1 ? "s" : ""} selected
              </p>
            )}
          </div>
          <FieldError>{error}</FieldError>
          <Button type="submit" disabled={busy}>
            {busy ? "Adding…" : "Add to the library"}
          </Button>
        </form>
      </Card>
    </main>
  );
}
