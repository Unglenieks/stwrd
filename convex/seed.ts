// Local-dev seed: creates realistic users, categories, branches, items, and claims.
// Run after setup wizard: npx convex run seed:populate
import { createAccount } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { appendLedger } from "./lib/ledger";

// 1×1 white PNG (generated, valid PNG bytes)
const PLACEHOLDER_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC";

const SEED_USERS = [
  { name: "Ben Torres",      email: "ben@stwrd.local",    password: "Member2024!", phone: "555-0101" },
  { name: "Cleo Williams",   email: "cleo@stwrd.local",   password: "Member2024!", phone: "555-0102" },
  { name: "Diana Chen",      email: "diana@stwrd.local",  password: "Member2024!", phone: "555-0103" },
  { name: "Ethan Park",      email: "ethan@stwrd.local",  password: "Member2024!", phone: "555-0104" },
  { name: "Fiona Russo",     email: "fiona@stwrd.local",  password: "Member2024!", phone: null },
  { name: "Gabe Kim",        email: "gabe@stwrd.local",   password: "Member2024!", phone: "555-0106" },
  { name: "Hannah Osei",     email: "hannah@stwrd.local", password: "Member2024!", phone: null },
  { name: "Ivan Petrov",     email: "ivan@stwrd.local",   password: "Member2024!", phone: "555-0108" },
  { name: "Julia Santos",    email: "julia@stwrd.local",  password: "Member2024!", phone: "555-0109" },
  { name: "Kevin O'Brien",   email: "kevin@stwrd.local",  password: "Member2024!", phone: null },
  { name: "Leila Nasser",    email: "leila@stwrd.local",  password: "Member2024!", phone: "555-0111" },
  { name: "Marco Fontaine",  email: "marco@stwrd.local",  password: "Member2024!", phone: "555-0112" },
  { name: "Nadia Volkov",    email: "nadia@stwrd.local",  password: "Member2024!", phone: null },
  { name: "Oliver Gray",     email: "oliver@stwrd.local", password: "Member2024!", phone: "555-0114" },
];

export const userCount = internalQuery({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    return users.length;
  },
});

export const getUploadUrl = internalAction({
  args: {},
  handler: async (ctx): Promise<{ uploadUrl: string }> => {
    const uploadUrl = await ctx.storage.generateUploadUrl();
    return { uploadUrl };
  },
});

export const populate = internalAction({
  args: { storageId: v.optional(v.id("_storage")) },
  handler: async (ctx, { storageId }): Promise<{ status: string; users?: number }> => {
    const count = await ctx.runQuery(internal.seed.userCount, {});
    if (count > 1) return { status: "already_seeded", users: count };

    // Accept pre-uploaded storageId or upload from within the action.
    let photoId: Id<"_storage">;
    if (storageId) {
      photoId = storageId;
    } else {
      const uploadUrl = await ctx.storage.generateUploadUrl();
      const pngBytes = Uint8Array.from(atob(PLACEHOLDER_PNG_B64), (c) => c.charCodeAt(0));
      const uploadResp = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": "image/png" },
        body: pngBytes,
      });
      const { storageId: sid } = (await uploadResp.json()) as { storageId: string };
      photoId = sid as Id<"_storage">;
    }

    // Create member accounts.
    const userIds: Record<string, Id<"users">> = {};
    for (const u of SEED_USERS) {
      const now = Date.now();
      const { user } = await createAccount(ctx, {
        provider: "credentials",
        account: { id: u.email, secret: u.password },
        profile: {
          email: u.email,
          name: u.name,
          status: "active",
          contactPhone: u.phone ?? undefined,
          notificationPref: "in_app",
          defaultExchangePref: null,
          createdAt: now,
        } as never,
      });
      userIds[u.email] = user._id as Id<"users">;
    }

    await ctx.runMutation(internal.seed.insertAll, { userIds, photoId });
    return { status: "seeded", users: Object.keys(userIds).length + 1 };
  },
});

export const insertAll = internalMutation({
  args: {
    userIds: v.record(v.string(), v.id("users")),
    photoId: v.id("_storage"),
  },
  handler: async (ctx, { userIds, photoId }) => {
    // Resolve server-manager (first user, created by wizard).
    const allUsers = await ctx.db.query("users").collect();
    const alice = allUsers.find(
      (u) => !Object.values(userIds).includes(u._id as Id<"users">),
    );
    if (!alice) throw new Error("Server manager not found; run setup wizard first.");
    const aliceId = alice._id;

    // Assign Member role to all seeded users.
    const memberRole = await ctx.db
      .query("roles")
      .withIndex("by_name", (q) => q.eq("name", "Member"))
      .first();
    if (memberRole) {
      for (const uid of Object.values(userIds)) {
        const already = await ctx.db
          .query("roleAssignments")
          .withIndex("by_user_role", (q) => q.eq("userId", uid).eq("roleId", memberRole._id))
          .first();
        if (!already) {
          await ctx.db.insert("roleAssignments", { userId: uid, roleId: memberRole._id });
        }
      }
    }

    const ben    = userIds["ben@stwrd.local"]!;
    const cleo   = userIds["cleo@stwrd.local"]!;
    const diana  = userIds["diana@stwrd.local"]!;
    const ethan  = userIds["ethan@stwrd.local"]!;
    const fiona  = userIds["fiona@stwrd.local"]!;
    const gabe   = userIds["gabe@stwrd.local"]!;
    const hannah = userIds["hannah@stwrd.local"]!;
    const ivan   = userIds["ivan@stwrd.local"]!;
    const julia  = userIds["julia@stwrd.local"]!;
    const kevin  = userIds["kevin@stwrd.local"]!;
    const leila  = userIds["leila@stwrd.local"]!;
    const marco  = userIds["marco@stwrd.local"]!;
    const nadia  = userIds["nadia@stwrd.local"]!;
    const oliver = userIds["oliver@stwrd.local"]!;

    // ── Categories ────────────────────────────────────────────────────────────
    const catTools = await ctx.db.insert("categories", {
      name: "Tools & Hardware", archived: false,
      description: "Power tools, hand tools, and garden equipment.",
    });
    const catPowerTools = await ctx.db.insert("categories", {
      name: "Power Tools", parentId: catTools, archived: false,
    });
    const catHandTools = await ctx.db.insert("categories", {
      name: "Hand Tools", parentId: catTools, archived: false,
    });
    const catGarden = await ctx.db.insert("categories", {
      name: "Garden Tools", parentId: catTools, archived: false,
    });

    const catKitchen = await ctx.db.insert("categories", {
      name: "Kitchen & Home", archived: false,
      description: "Appliances and cookware for home projects.",
    });
    const catAppliances = await ctx.db.insert("categories", {
      name: "Small Appliances", parentId: catKitchen, archived: false,
    });
    const catBakeware = await ctx.db.insert("categories", {
      name: "Bakeware & Cookware", parentId: catKitchen, archived: false,
    });

    const catSports = await ctx.db.insert("categories", {
      name: "Sports & Outdoor", archived: false,
      description: "Camping, cycling, and water sports gear.",
    });
    const catCamping = await ctx.db.insert("categories", {
      name: "Camping & Hiking", parentId: catSports, archived: false,
    });
    const catWater = await ctx.db.insert("categories", {
      name: "Water Sports", parentId: catSports, archived: false,
    });
    const catCycling = await ctx.db.insert("categories", {
      name: "Cycling", parentId: catSports, archived: false,
    });

    const catMedia = await ctx.db.insert("categories", {
      name: "Photography & Media", archived: false,
      description: "Cameras, AV equipment, and lighting.",
    });
    const catCamera = await ctx.db.insert("categories", {
      name: "Camera Equipment", parentId: catMedia, archived: false,
    });
    const catAV = await ctx.db.insert("categories", {
      name: "Audio / Visual", parentId: catMedia, archived: false,
    });

    // ── Branches ─────────────────────────────────────────────────────────────
    const branchRiverside = await ctx.db.insert("branches", {
      name: "Riverside Tool Library",
      hostUserId: diana,
      description: "Community tool library with a great selection of power and hand tools.",
      locationText: "45 Riverside Drive — pickup by appointment",
      accessNotes: "Text Diana at 555-0103 to arrange pickup. Gate code: 4821.",
      photoFileIds: [],
      status: "active",
    });
    const branchWestfield = await ctx.db.insert("branches", {
      name: "Westfield Maker Hub",
      hostUserId: ethan,
      description: "Maker space and lending library for crafters and builders.",
      locationText: "112 Westfield Avenue, Unit B — open Sat 10-2pm",
      accessNotes: "Walk-in Saturdays 10am–2pm; other times email ethan@stwrd.local.",
      photoFileIds: [],
      status: "active",
    });

    // ── Helper to insert item + initial ledger entry ───────────────────────
    const now = Date.now();

    async function addItem(opts: {
      title: string;
      description: string;
      categoryId: Id<"categories">;
      tags: string[];
      condition: number;
      custodian: Id<"users">;
      contributor: Id<"users">;
      state: "available" | "claimed" | "in_custody" | "under_repair";
      exchangePref: "reveal_contact" | "branch";
      atBranchId?: Id<"branches">;
      attributes?: { key: string; value: string }[];
      offsetMs?: number;
    }): Promise<Id<"items">> {
      const ts = now - (opts.offsetMs ?? 0);
      const id = await ctx.db.insert("items", {
        title: opts.title,
        description: opts.description,
        categoryId: opts.categoryId,
        tags: opts.tags,
        attributes: opts.attributes ?? [],
        state: opts.state,
        custodianId: opts.custodian,
        atBranchId: opts.atBranchId,
        conditionRating: opts.condition,
        primaryPhotoId: photoId,
        ledgerSeq: 0,
        exchangePref: opts.exchangePref,
        contributedBy: opts.contributor,
        contributedAt: ts,
        lastAvailableAt: opts.state === "available" ? ts : ts - 86_400_000,
        searchText: [opts.title, opts.description, ...opts.tags].join(" ").toLowerCase(),
      });
      const item = (await ctx.db.get(id))!;
      await appendLedger(ctx, item, {
        type: "contributed",
        actorId: opts.contributor,
        conditionRating: opts.condition,
        photoFileIds: [photoId],
        branchId: opts.atBranchId,
      });
      return id;
    }

    // ── Items: Power Tools ────────────────────────────────────────────────────
    const drillId = await addItem({
      title: "DeWalt 20V MAX Cordless Drill",
      description: "Brushless motor, 2-speed gearbox, includes two 2Ah batteries and charger. In great condition.",
      categoryId: catPowerTools, tags: ["dewalt", "drill", "cordless", "20v"],
      attributes: [{ key: "Brand", value: "DeWalt" }, { key: "Voltage", value: "20V" }],
      condition: 4, custodian: aliceId, contributor: aliceId, state: "available",
      exchangePref: "branch", atBranchId: branchRiverside, offsetMs: 60 * 86_400_000,
    });

    const sawId = await addItem({
      title: "Ryobi 7-1/4\" Circular Saw",
      description: "Corded circular saw with laser guide. Blade included. Great for decking and framing.",
      categoryId: catPowerTools, tags: ["ryobi", "circular-saw", "corded"],
      condition: 3, custodian: ben, contributor: ben, state: "available",
      exchangePref: "reveal_contact", offsetMs: 45 * 86_400_000,
    });

    const sanderItemId = await addItem({
      title: "Bosch 5\" Random Orbit Sander",
      description: "Variable-speed with dust collection bag. Perfect for finishing work. Dust bag included.",
      categoryId: catPowerTools, tags: ["bosch", "sander", "orbital"],
      condition: 5, custodian: cleo, contributor: cleo, state: "available",
      exchangePref: "reveal_contact", offsetMs: 30 * 86_400_000,
    });

    // Milwaukee saw — currently in_custody (claimed by Fiona, completed handoff)
    const milwaukeeId = await addItem({
      title: "Milwaukee M18 Reciprocating Saw",
      description: "Fuel brushless motor, tool-free blade change. Includes M18 5Ah battery.",
      categoryId: catPowerTools, tags: ["milwaukee", "reciprocating-saw", "m18"],
      attributes: [{ key: "Battery", value: "M18 5Ah" }],
      condition: 4, custodian: fiona, contributor: diana, state: "in_custody",
      exchangePref: "branch", atBranchId: branchRiverside, offsetMs: 20 * 86_400_000,
    });

    const grinderItemId = await addItem({
      title: "Makita 4-1/2\" Angle Grinder",
      description: "4.5A motor, paddle switch, disc guard. Includes one cutting disc.",
      categoryId: catPowerTools, tags: ["makita", "grinder", "angle-grinder"],
      condition: 3, custodian: ethan, contributor: ethan, state: "available",
      exchangePref: "branch", atBranchId: branchWestfield, offsetMs: 55 * 86_400_000,
    });

    // ── Items: Hand Tools ─────────────────────────────────────────────────────
    await addItem({
      title: "48\" Professional Spirit Level",
      description: "Extruded aluminum frame, 3 vials, magnetic base. Ideal for framing and tile.",
      categoryId: catHandTools, tags: ["level", "spirit-level", "48-inch"],
      condition: 5, custodian: gabe, contributor: gabe, state: "available",
      exchangePref: "reveal_contact", offsetMs: 40 * 86_400_000,
    });

    await addItem({
      title: "6-Piece Chisel Set with Mallet",
      description: "Chrome vanadium steel, hardwood handles, 1/4\" to 1\" widths. Includes storage roll.",
      categoryId: catHandTools, tags: ["chisels", "woodworking", "mallet"],
      condition: 4, custodian: hannah, contributor: hannah, state: "available",
      exchangePref: "reveal_contact", offsetMs: 25 * 86_400_000,
    });

    await addItem({
      title: "20 oz Titanium Framing Hammer",
      description: "Milled face, straight handle. Light and balanced. Used but solid.",
      categoryId: catHandTools, tags: ["hammer", "framing", "titanium"],
      condition: 4, custodian: ivan, contributor: ivan, state: "available",
      exchangePref: "reveal_contact", offsetMs: 50 * 86_400_000,
    });

    await addItem({
      title: "15\" Japanese Pull Saw",
      description: "Pull-stroke blade, fine crosscut teeth. Cuts on pull stroke for precision work.",
      categoryId: catHandTools, tags: ["pull-saw", "japanese-saw", "hand-saw"],
      condition: 4, custodian: julia, contributor: julia, state: "available",
      exchangePref: "reveal_contact", offsetMs: 35 * 86_400_000,
    });

    // ── Items: Garden Tools ───────────────────────────────────────────────────
    await addItem({
      title: "6-Step Fiberglass Ladder (12 ft)",
      description: "Type I duty rating, 250 lb capacity, slip-resistant feet. Great shape.",
      categoryId: catGarden, tags: ["ladder", "fiberglass", "12ft"],
      condition: 4, custodian: kevin, contributor: kevin, state: "available",
      exchangePref: "reveal_contact", offsetMs: 70 * 86_400_000,
    });

    // Leaf blower — in_custody (Ben picked it up, completed claim)
    const blowerItemId = await addItem({
      title: "Husqvarna 125B Gas Leaf Blower",
      description: "28cc engine, 170 mph air velocity. Good runner; mix fuel 50:1.",
      categoryId: catGarden, tags: ["leaf-blower", "husqvarna", "gas"],
      condition: 3, custodian: ben, contributor: leila, state: "in_custody",
      exchangePref: "reveal_contact", offsetMs: 10 * 86_400_000,
    });

    await addItem({
      title: "Garden Hose — 75 ft (with Fittings)",
      description: "Heavy-duty rubber hose, 5/8\" diameter, quick-connect fittings at both ends.",
      categoryId: catGarden, tags: ["garden-hose", "rubber", "75ft"],
      condition: 4, custodian: marco, contributor: marco, state: "available",
      exchangePref: "branch", atBranchId: branchRiverside, offsetMs: 65 * 86_400_000,
    });

    // ── Items: Small Appliances ───────────────────────────────────────────────
    await addItem({
      title: "KitchenAid Artisan Stand Mixer (5 qt)",
      description: "Empire Red, 10 speeds, includes flat beater, dough hook, and wire whip. Barely used.",
      categoryId: catAppliances, tags: ["kitchenaid", "stand-mixer", "mixer"],
      attributes: [{ key: "Capacity", value: "5 qt" }, { key: "Color", value: "Empire Red" }],
      condition: 5, custodian: nadia, contributor: nadia, state: "available",
      exchangePref: "reveal_contact", offsetMs: 15 * 86_400_000,
    });

    const instantPotItemId = await addItem({
      title: "Instant Pot Duo 8 qt",
      description: "7-in-1 pressure cooker. Includes trivet, manual, and recipe booklet.",
      categoryId: catAppliances, tags: ["instant-pot", "pressure-cooker", "8qt"],
      condition: 4, custodian: oliver, contributor: oliver, state: "available",
      exchangePref: "reveal_contact", offsetMs: 28 * 86_400_000,
    });

    // Ninja blender — currently claimed by Cleo (pending claim)
    const blenderItemId = await addItem({
      title: "Ninja Professional Blender (72 oz)",
      description: "1000W motor, XL 72 oz pitcher with lid. All dishwasher-safe parts.",
      categoryId: catAppliances, tags: ["ninja", "blender", "72oz"],
      condition: 4, custodian: aliceId, contributor: aliceId, state: "claimed",
      exchangePref: "reveal_contact", offsetMs: 42 * 86_400_000,
    });

    await addItem({
      title: "Cuisinart Automatic Bread Maker",
      description: "12 preset programs, 2 lb loaf capacity. Includes measuring cup and paddle.",
      categoryId: catAppliances, tags: ["bread-maker", "cuisinart", "baking"],
      condition: 3, custodian: ben, contributor: ben, state: "available",
      exchangePref: "reveal_contact", offsetMs: 80 * 86_400_000,
    });

    await addItem({
      title: "Excalibur 5-Tray Food Dehydrator",
      description: "Square trays, adjustable thermostat 95–165°F. Good for jerky, fruit, herbs.",
      categoryId: catAppliances, tags: ["dehydrator", "excalibur", "food-dehydrator"],
      condition: 4, custodian: cleo, contributor: cleo, state: "available",
      exchangePref: "reveal_contact", offsetMs: 22 * 86_400_000,
    });

    // ── Items: Bakeware ───────────────────────────────────────────────────────
    await addItem({
      title: "Lodge 6 qt Cast Iron Dutch Oven",
      description: "Pre-seasoned, oven-safe to 500°F. Heavy but worth it. Minor surface discolouration.",
      categoryId: catBakeware, tags: ["dutch-oven", "cast-iron", "lodge"],
      condition: 4, custodian: diana, contributor: diana, state: "available",
      exchangePref: "branch", atBranchId: branchRiverside, offsetMs: 90 * 86_400_000,
    });

    await addItem({
      title: "Nordic Ware Platinum Bundt Pan",
      description: "Non-stick, dishwasher safe, 12-cup capacity. Classic fluted design.",
      categoryId: catBakeware, tags: ["bundt-pan", "nordic-ware", "baking"],
      condition: 5, custodian: fiona, contributor: fiona, state: "available",
      exchangePref: "reveal_contact", offsetMs: 48 * 86_400_000,
    });

    // ── Items: Camping ────────────────────────────────────────────────────────
    await addItem({
      title: "Coleman 4-Person Dark Room Tent",
      description: "Blocks 90% of sunlight, fits queen air mattress. Stakes and guylines included.",
      categoryId: catCamping, tags: ["tent", "coleman", "4-person", "camping"],
      attributes: [{ key: "Capacity", value: "4 person" }, { key: "Season", value: "3-season" }],
      condition: 3, custodian: gabe, contributor: gabe, state: "available",
      exchangePref: "branch", atBranchId: branchWestfield, offsetMs: 120 * 86_400_000,
    });

    await addItem({
      title: "REI Co-op Sleeping Bags (2×)",
      description: "Mummy bags, 20°F rated, right-zip. Stored loosely; no compression damage.",
      categoryId: catCamping, tags: ["sleeping-bag", "rei", "mummy", "20f"],
      condition: 4, custodian: hannah, contributor: hannah, state: "available",
      exchangePref: "reveal_contact", offsetMs: 75 * 86_400_000,
    });

    // Trekking poles — in_custody by Kevin (completed claim from Ivan)
    const polesItemId = await addItem({
      title: "Black Diamond Trail Trekking Poles (pair)",
      description: "Aluminum, flick-lock adjustable 62–140cm, foam grips. Light trail use.",
      categoryId: catCamping, tags: ["trekking-poles", "black-diamond", "hiking"],
      condition: 4, custodian: kevin, contributor: ivan, state: "in_custody",
      exchangePref: "reveal_contact", offsetMs: 8 * 86_400_000,
    });

    await addItem({
      title: "MSR Pocket Rocket 2 Stove + Cookset",
      description: "Ultralight stove with 4-piece hard-anodized cookset (0.9L + 1.5L pots). Fuel not included.",
      categoryId: catCamping, tags: ["backpacking", "stove", "msr", "cookset"],
      condition: 4, custodian: julia, contributor: julia, state: "available",
      exchangePref: "reveal_contact", offsetMs: 33 * 86_400_000,
    });

    // ── Items: Water Sports ───────────────────────────────────────────────────
    await addItem({
      title: "iRocker Cruiser 10'6\" Stand-Up Paddleboard",
      description: "Inflatable SUP, 6\" thick, 300 lb capacity. Pump, leash, fin, backpack included.",
      categoryId: catWater, tags: ["paddleboard", "sup", "inflatable"],
      condition: 3, custodian: kevin, contributor: kevin, state: "available",
      exchangePref: "reveal_contact", offsetMs: 55 * 86_400_000,
    });

    await addItem({
      title: "Life Vest Set (4× Adult PFDs)",
      description: "US Coast Guard approved, Type III. Mixed sizes M/L. Good condition.",
      categoryId: catWater, tags: ["life-vest", "pfd", "kayak", "water-safety"],
      condition: 4, custodian: leila, contributor: leila, state: "available",
      exchangePref: "reveal_contact", offsetMs: 95 * 86_400_000,
    });

    await addItem({
      title: "Cressi Adult Snorkel Set",
      description: "Tempered glass mask, dry-top snorkel, open-heel fins. Size M fins.",
      categoryId: catWater, tags: ["snorkel", "cressi", "fins", "mask"],
      condition: 5, custodian: marco, contributor: marco, state: "available",
      exchangePref: "reveal_contact", offsetMs: 100 * 86_400_000,
    });

    // ── Items: Cycling ────────────────────────────────────────────────────────
    await addItem({
      title: "Park Tool PCS-10.3 Repair Stand",
      description: "Home mechanic stand, clamp adjusts 22–32mm. Folds flat for storage.",
      categoryId: catCycling, tags: ["bike-stand", "park-tool", "repair-stand"],
      condition: 4, custodian: nadia, contributor: nadia, state: "available",
      exchangePref: "reveal_contact", offsetMs: 58 * 86_400_000,
    });

    await addItem({
      title: "Lezyne Steel Floor Drive Pump",
      description: "200 psi max, dual-valve head, large gauge. Works on Presta and Schrader.",
      categoryId: catCycling, tags: ["bike-pump", "floor-pump", "lezyne"],
      condition: 5, custodian: oliver, contributor: oliver, state: "available",
      exchangePref: "reveal_contact", offsetMs: 38 * 86_400_000,
    });

    // ── Items: Camera Equipment ───────────────────────────────────────────────
    await addItem({
      title: "Nikon D3500 DSLR Kit (18–55mm lens)",
      description: "24.2MP, beginner-friendly, 1500-shot battery life. Kit lens + 2 batteries + strap + bag.",
      categoryId: catCamera, tags: ["nikon", "dslr", "camera", "d3500"],
      attributes: [{ key: "Megapixels", value: "24.2MP" }, { key: "Mount", value: "Nikon F" }],
      condition: 4, custodian: aliceId, contributor: aliceId, state: "available",
      exchangePref: "branch", atBranchId: branchRiverside, offsetMs: 85 * 86_400_000,
    });

    await addItem({
      title: "Manfrotto Befree Compact Travel Tripod",
      description: "Aluminum, ball head, 4-section legs, 8.8 lb capacity. In original bag.",
      categoryId: catCamera, tags: ["tripod", "manfrotto", "travel-tripod"],
      condition: 5, custodian: ben, contributor: ben, state: "available",
      exchangePref: "reveal_contact", offsetMs: 12 * 86_400_000,
    });

    await addItem({
      title: "Neewer 18\" Ring Light Kit",
      description: "Bi-colour 3200–5500K, includes 75\" light stand and phone holder.",
      categoryId: catCamera, tags: ["ring-light", "neewer", "lighting", "photography"],
      condition: 4, custodian: cleo, contributor: cleo, state: "available",
      exchangePref: "reveal_contact", offsetMs: 18 * 86_400_000,
    });

    // ── Items: Audio/Visual ───────────────────────────────────────────────────
    // Projector — under repair
    const projectorItemId = await addItem({
      title: "Epson EF-100 Mini-Laser Projector",
      description: "Android TV built-in, 2000 lumens, HDMI + USB. Sent for lamp service.",
      categoryId: catAV, tags: ["projector", "epson", "laser", "mini-projector"],
      condition: 2, custodian: diana, contributor: diana, state: "under_repair",
      exchangePref: "reveal_contact", offsetMs: 5 * 86_400_000,
    });

    await addItem({
      title: "Yamaha DBR12 Active PA Speaker",
      description: "1000W, 12\" woofer, DSP presets, XLR + TRS inputs. Ideal for small events.",
      categoryId: catAV, tags: ["pa-speaker", "yamaha", "active-speaker"],
      condition: 3, custodian: ethan, contributor: ethan, state: "available",
      exchangePref: "branch", atBranchId: branchWestfield, offsetMs: 110 * 86_400_000,
    });

    // ── Ledger: status/repair entries for non-available items ─────────────────

    // Milwaukee saw: record completed handoff (diana → fiona)
    {
      const claimId = await ctx.db.insert("claims", {
        itemId: milwaukeeId,
        claimantId: fiona,
        purpose: "use",
        staging: false,
        state: "completed",
        exchangeMode: "branch",
        branchId: branchRiverside,
        contactRevealed: false,
        receiverPhotoIds: [],
        receiverCondition: 4,
        giverConfirmedAt: now - 9 * 86_400_000,
        receiverConfirmedAt: now - 9 * 86_400_000,
        expiresAt: now + 63 * 86_400_000,
        createdAt: now - 12 * 86_400_000,
      });
      let item = (await ctx.db.get(milwaukeeId))!;
      await appendLedger(ctx, item, {
        type: "claimed", actorId: fiona, counterpartyId: diana, claimId, photoFileIds: [],
      });
      item = (await ctx.db.get(milwaukeeId))!;
      await appendLedger(ctx, item, {
        type: "handoff_completed", actorId: fiona, counterpartyId: diana, claimId,
        conditionRating: 4, photoFileIds: [],
      });
    }

    // Leaf blower: record completed handoff (leila → ben)
    {
      const claimId = await ctx.db.insert("claims", {
        itemId: blowerItemId,
        claimantId: ben,
        purpose: "use",
        staging: false,
        state: "completed",
        exchangeMode: "reveal_contact",
        contactRevealed: true,
        receiverPhotoIds: [],
        receiverCondition: 3,
        giverConfirmedAt: now - 4 * 86_400_000,
        receiverConfirmedAt: now - 4 * 86_400_000,
        expiresAt: now + 68 * 86_400_000,
        createdAt: now - 6 * 86_400_000,
      });
      let item = (await ctx.db.get(blowerItemId))!;
      await appendLedger(ctx, item, {
        type: "claimed", actorId: ben, counterpartyId: leila, claimId, photoFileIds: [],
      });
      item = (await ctx.db.get(blowerItemId))!;
      await appendLedger(ctx, item, {
        type: "handoff_completed", actorId: ben, counterpartyId: leila, claimId,
        conditionRating: 3, photoFileIds: [],
      });
    }

    // Trekking poles: record completed handoff (ivan → kevin)
    {
      const claimId = await ctx.db.insert("claims", {
        itemId: polesItemId,
        claimantId: kevin,
        purpose: "use",
        staging: false,
        state: "completed",
        exchangeMode: "reveal_contact",
        contactRevealed: true,
        receiverPhotoIds: [],
        receiverCondition: 4,
        giverConfirmedAt: now - 2 * 86_400_000,
        receiverConfirmedAt: now - 2 * 86_400_000,
        expiresAt: now + 70 * 86_400_000,
        createdAt: now - 5 * 86_400_000,
      });
      let item = (await ctx.db.get(polesItemId))!;
      await appendLedger(ctx, item, {
        type: "claimed", actorId: kevin, counterpartyId: ivan, claimId, photoFileIds: [],
      });
      item = (await ctx.db.get(polesItemId))!;
      await appendLedger(ctx, item, {
        type: "handoff_completed", actorId: kevin, counterpartyId: ivan, claimId,
        conditionRating: 4, photoFileIds: [],
      });
    }

    // Projector: under_repair ledger entry
    {
      const item = (await ctx.db.get(projectorItemId))!;
      await appendLedger(ctx, item, {
        type: "repair_started", actorId: diana,
        note: "Sent to Epson authorized service centre for lamp replacement.",
        photoFileIds: [],
      });
    }

    // ── Active claims ─────────────────────────────────────────────────────────

    // Ninja blender: Cleo has a pending claim from Alice
    {
      const claimId = await ctx.db.insert("claims", {
        itemId: blenderItemId,
        claimantId: cleo,
        purpose: "use",
        staging: false,
        state: "pending",
        exchangeMode: "reveal_contact",
        contactRevealed: false,
        receiverPhotoIds: [],
        expiresAt: now + 72 * 3_600_000,
        createdAt: now - 2 * 3_600_000,
      });
      const item = (await ctx.db.get(blenderItemId))!;
      await appendLedger(ctx, item, {
        type: "claimed", actorId: cleo, counterpartyId: aliceId, claimId, photoFileIds: [],
      });
    }

    // Circular saw: Gabe has a giver-confirmed claim from Ben
    {
      await ctx.db.patch(sawId, { state: "claimed" });
      const claimId = await ctx.db.insert("claims", {
        itemId: sawId,
        claimantId: gabe,
        purpose: "use",
        staging: false,
        state: "giver_confirmed",
        exchangeMode: "reveal_contact",
        contactRevealed: true,
        receiverPhotoIds: [],
        giverConfirmedAt: now - 1 * 3_600_000,
        expiresAt: now + 71 * 3_600_000,
        createdAt: now - 6 * 3_600_000,
      });
      const item = (await ctx.db.get(sawId))!;
      await appendLedger(ctx, item, {
        type: "claimed", actorId: gabe, counterpartyId: ben, claimId, photoFileIds: [],
      });
    }

    // Instant Pot: Julia has a pending claim from Oliver
    {
      await ctx.db.patch(instantPotItemId, { state: "claimed" });
      const claimId = await ctx.db.insert("claims", {
        itemId: instantPotItemId,
        claimantId: julia,
        purpose: "use",
        staging: false,
        state: "pending",
        exchangeMode: "reveal_contact",
        contactRevealed: false,
        receiverPhotoIds: [],
        expiresAt: now + 70 * 3_600_000,
        createdAt: now - 4 * 3_600_000,
      });
      const item = (await ctx.db.get(instantPotItemId))!;
      await appendLedger(ctx, item, {
        type: "claimed", actorId: julia, counterpartyId: oliver, claimId, photoFileIds: [],
      });
    }

    // ── Watches (a few members watching items) ────────────────────────────────
    await ctx.db.insert("watches", { userId: hannah, itemId: drillId, createdAt: now - 3 * 86_400_000 });
    await ctx.db.insert("watches", { userId: marco,  itemId: drillId, createdAt: now - 1 * 86_400_000 });
    await ctx.db.insert("watches", { userId: nadia,  itemId: sanderItemId, createdAt: now - 2 * 86_400_000 });
    await ctx.db.insert("watches", { userId: oliver, itemId: grinderItemId, createdAt: now - 86_400_000 });

    // ── Notifications: a few unread for Alice (server manager) ───────────────
    await ctx.db.insert("notifications", {
      userId: aliceId,
      kind: "claim_created",
      payload: { itemId: blenderItemId, claimantName: "Cleo Williams" },
      read: false,
      createdAt: now - 2 * 3_600_000,
    });
    await ctx.db.insert("notifications", {
      userId: ben,
      kind: "claim_giver_confirmed",
      payload: { itemId: sawId, claimantName: "Gabe Kim" },
      read: false,
      createdAt: now - 1 * 3_600_000,
    });
    await ctx.db.insert("notifications", {
      userId: oliver,
      kind: "claim_created",
      payload: { itemId: instantPotItemId, claimantName: "Julia Santos" },
      read: false,
      createdAt: now - 4 * 3_600_000,
    });
  },
});
