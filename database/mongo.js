import { MongoClient } from "mongodb";
import { getSmtpProviderName } from "../config/smtpConfig.js";

let client;
let database;

const collectionNames = {
  leads: "leads",
  emailStats: "emailStats"
};

const connectToMongo = async () => {
  if (database) {
    return database;
  }

  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB_NAME ?? "ai_outreach_agent";

  if (!uri) {
    throw new Error("MONGODB_URI is required.");
  }

  client = new MongoClient(uri, {
    maxPoolSize: 10
  });

  await client.connect();
  database = client.db(dbName);
  await ensureCollections();
  return database;
};

const ensureCollections = async () => {
  const db = database ?? (await connectToMongo());
  const leads = db.collection(collectionNames.leads);
  const emailStats = db.collection(collectionNames.emailStats);

  await Promise.all([
    leads.createIndex({ website: 1 }, { unique: true, sparse: true }),
    leads.createIndex({ mapsUrl: 1 }, { unique: true, sparse: true }),
    leads.createIndex({ placeId: 1 }, { unique: true, sparse: true }),
    leads.createIndex({ name: 1, city: 1, country: 1, industry: 1 }),
    leads.createIndex({ contacted: 1, followupSent: 1, score: -1 }),
    leads.createIndex({ nextFollowupAt: 1 }),
    emailStats.createIndex({ provider: 1 }, { unique: true })
  ]);
};

const getCollection = async (name) => {
  const db = database ?? (await connectToMongo());
  return db.collection(name);
};

const getLeadsCollection = async () => {
  return getCollection(collectionNames.leads);
};

const getEmailStatsCollection = async () => {
  return getCollection(collectionNames.emailStats);
};

const compactLeadFields = (lead) => {
  const fields = {
    name: lead.name,
    sourceText: lead.sourceText ?? null,
    hasWebsite: Boolean(lead.hasWebsite),
    email: lead.email ?? null,
    industry: lead.industry,
    city: lead.city,
    country: lead.country,
    timezone: lead.timezone ?? "UTC",
    tier: lead.tier,
    speedScore: lead.speedScore ?? null,
    slowWebsite: Boolean(lead.slowWebsite),
    homepageLoadTimeMs: lead.homepageLoadTimeMs ?? null,
    score: lead.score ?? 0,
    isTarget: Boolean(lead.isTarget),
    subjectLine: lead.subjectLine ?? null,
    emailBody: lead.emailBody ?? null,
    followupBody: lead.followupBody ?? null,
    updatedAt: new Date()
  };

  if (lead.website) {
    fields.website = lead.website;
  }

  if (lead.mapsUrl) {
    fields.mapsUrl = lead.mapsUrl;
  }

  if (lead.placeId) {
    fields.placeId = lead.placeId;
  }

  return fields;
};

const upsertLead = async (lead) => {
  const leads = await getLeadsCollection();
  const identityFilter = lead.website
    ? { website: lead.website }
    : lead.mapsUrl
      ? { mapsUrl: lead.mapsUrl }
      : lead.placeId
        ? { placeId: lead.placeId }
        : {
            name: lead.name,
            city: lead.city,
            country: lead.country,
            industry: lead.industry
          };

  await leads.updateOne(
    identityFilter,
    {
      $set: compactLeadFields(lead),
      $unset: {
        ...(lead.website ? {} : { website: "" }),
        ...(lead.mapsUrl ? {} : { mapsUrl: "" }),
        ...(lead.placeId ? {} : { placeId: "" })
      },
      $setOnInsert: {
        createdAt: new Date(),
        contacted: false,
        contactedDate: null,
        followupSent: false,
        nextFollowupAt: null
      }
    },
    { upsert: true }
  );
};

const findLeads = async (query = {}, options = {}) => {
  const leads = await getLeadsCollection();
  return leads.find(query, options).toArray();
};

const getLeadById = async (id) => {
  const leads = await getLeadsCollection();
  return leads.findOne({ _id: id });
};

const getSentEmails = async (limit = 50) => {
  const leads = await getLeadsCollection();
  return leads.find(
    { contacted: true },
    {
      projection: {
        name: 1,
        email: 1,
        city: 1,
        country: 1,
        industry: 1,
        subjectLine: 1,
        emailBody: 1,
        followupBody: 1,
        contactedDate: 1,
        followupSent: 1,
        website: 1,
        hasWebsite: 1
      },
      sort: { contactedDate: -1 },
      limit
    }
  ).toArray();
};

const updateLead = async (filter, update) => {
  const leads = await getLeadsCollection();
  return leads.updateMany(filter, update);
};

const getEmailStats = async (provider = getSmtpProviderName()) => {
  const emailStats = await getEmailStatsCollection();
  const stats = await emailStats.findOne({ provider });

  if (stats) {
    return stats;
  }

  const freshStats = {
    provider,
    emailsSentToday: 0,
    emailsSentThisHour: 0,
    lastDailyReset: new Date(),
    lastHourlyReset: new Date(),
    createdAt: new Date(),
    updatedAt: new Date()
  };

  await emailStats.insertOne(freshStats);
  return freshStats;
};

const resetEmailStatsIfNeeded = async (provider = getSmtpProviderName()) => {
  const emailStats = await getEmailStatsCollection();
  const stats = await getEmailStats(provider);
  const now = new Date();
  const currentHourKey = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}-${now.getUTCHours()}`;
  const lastHour = new Date(stats.lastHourlyReset);
  const lastHourKey = `${lastHour.getUTCFullYear()}-${lastHour.getUTCMonth()}-${lastHour.getUTCDate()}-${lastHour.getUTCHours()}`;
  const isNewHour = currentHourKey !== lastHourKey;
  const isNewDay = now.toDateString() !== new Date(stats.lastDailyReset).toDateString();

  const update = {
    updatedAt: now
  };

  if (isNewHour) {
    update.emailsSentThisHour = 0;
    update.lastHourlyReset = now;
  }

  if (isNewDay) {
    update.emailsSentToday = 0;
    update.lastDailyReset = now;
  }

  if (isNewHour || isNewDay) {
    await emailStats.updateOne({ provider }, { $set: update });
  }

  return getEmailStats(provider);
};

const incrementEmailStats = async (provider = getSmtpProviderName()) => {
  const emailStats = await getEmailStatsCollection();
  await resetEmailStatsIfNeeded(provider);
  await emailStats.updateOne(
    { provider },
    {
      $inc: {
        emailsSentToday: 1,
        emailsSentThisHour: 1
      },
      $set: {
        updatedAt: new Date()
      }
    }
  );
  return getEmailStats(provider);
};

const closeMongoConnection = async () => {
  if (client) {
    await client.close();
    client = undefined;
    database = undefined;
  }
};

export {
  closeMongoConnection,
  collectionNames,
  connectToMongo,
  ensureCollections,
  findLeads,
  getCollection,
  getEmailStats,
  getEmailStatsCollection,
  getLeadById,
  getLeadsCollection,
  getSentEmails,
  incrementEmailStats,
  resetEmailStatsIfNeeded,
  updateLead,
  upsertLead
};
