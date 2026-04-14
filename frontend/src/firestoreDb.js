import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { firestoreDb } from "./firebase";
import { buildHandleCandidate, decodeJwtPayload, normalizeUserId } from "./authIdentity";

const TOKEN_KEY = "pulse_token_v1";

const USERS_COLLECTION = "users";
const POSTS_COLLECTION = "posts";
const COMMENTS_COLLECTION = "comments";
const NOTIFICATIONS_COLLECTION = "notifications";
const FOLLOWS_COLLECTION = "follows";
const MESSAGES_COLLECTION = "messages";

const fallbackGaps = [
  {
    area: "DM Inbox Enhancements",
    whyItMatters: "Typing indicators and live delivery states improve conversation trust.",
    suggestedImplementation: "Add realtime typing and delivered/read state listeners.",
  },
  {
    area: "Media Upload Pipeline",
    whyItMatters: "Large media should not rely on direct external URLs for reliability.",
    suggestedImplementation: "Upload media to managed storage and persist secure URLs.",
  },
  {
    area: "Moderation Console",
    whyItMatters: "Teams need manual review controls for reports and appeals.",
    suggestedImplementation: "Create a moderator dashboard with triage and resolution actions.",
  },
];

let seedPromise = null;

function readToken() {
  if (typeof window === "undefined") {
    return "";
  }
  return window.localStorage.getItem(TOKEN_KEY) || "";
}

function decodeTokenPayload(token) {
  return decodeJwtPayload(token);
}

function parseNumericId(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return numeric;
}

function userIdsEqual(left, right) {
  const normalizedLeft = normalizeUserId(left);
  const normalizedRight = normalizeUserId(right);
  return normalizedLeft != null && normalizedLeft === normalizedRight;
}

function getCurrentUserId(optional = true) {
  const payload = decodeTokenPayload(readToken());
  const id = normalizeUserId(payload?.uid ?? payload?.user_id ?? payload?.sub);

  if (!optional && id == null) {
    throw new Error("Authentication required");
  }

  return id;
}

function nowMs() {
  return Date.now();
}

function newEntityId() {
  return `${Date.now()}${Math.floor(Math.random() * 10000).toString().padStart(4, "0")}`;
}

function asSerializableId(value) {
  const text = String(value);
  if (/^-?\d+$/.test(text)) {
    const numeric = Number(text);
    if (Number.isSafeInteger(numeric)) {
      return numeric;
    }
  }
  return text;
}

function toIso(valueMs) {
  const ms = Number(valueMs || 0);
  if (!Number.isFinite(ms) || ms <= 0) {
    return new Date().toISOString();
  }
  return new Date(ms).toISOString();
}

function normalizeStringArray(values, max = 6) {
  if (!Array.isArray(values)) {
    return [];
  }

  const normalized = [];
  for (const value of values) {
    const cleaned = String(value || "").trim();
    if (!cleaned || normalized.includes(cleaned)) {
      continue;
    }
    normalized.push(cleaned);
    if (normalized.length >= max) {
      break;
    }
  }

  return normalized;
}

function normalizeTags(values) {
  const tags = normalizeStringArray(values, 6)
    .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`))
    .map((tag) => tag.toLowerCase());
  return tags.length ? tags : ["#update"];
}

function normalizePollOptions(values) {
  const options = normalizeStringArray(values, 4)
    .map((option) => option.replace(/[|,:]/g, "").trim())
    .filter(Boolean)
    .slice(0, 4);

  if (options.length < 2) {
    return [];
  }

  return options;
}

function normalizeMediaUrls(values) {
  return normalizeStringArray(values, 4)
    .filter((url) => url.startsWith("https://") || url.startsWith("http://"));
}

function calculateInsightsFromRaw(rawPost) {
  const views = Number(rawPost.viewCount || 0);
  const engagementTotal = Number(rawPost.likeCount || 0)
    + Number(rawPost.repostCount || 0)
    + Number(rawPost.replyCount || 0)
    + Number(rawPost.bookmarkCount || 0)
    + Number(rawPost.commentCount || 0);
  const engagementRate = views === 0
    ? (engagementTotal === 0 ? 0 : 100)
    : Number(((engagementTotal * 100) / views).toFixed(2));

  return {
    views,
    engagementTotal,
    engagementRate,
  };
}

function normalizePostResponse(rawPost, docId, viewerId = null) {
  const pollOptions = normalizeStringArray(rawPost.pollOptions || [], 4);
  const pollVotes = rawPost.pollVotes && typeof rawPost.pollVotes === "object" ? rawPost.pollVotes : {};
  const voterUserIds = Array.isArray(rawPost.pollVoterUserIds)
    ? rawPost.pollVoterUserIds.map((value) => normalizeUserId(value)).filter((value) => value != null)
    : [];

  const totalVotes = pollOptions.reduce((sum, option) => sum + Number(pollVotes[option] || 0), 0);
  const poll = pollOptions.length
    ? {
        options: pollOptions.map((option) => {
          const votes = Number(pollVotes[option] || 0);
          return {
            label: option,
            votes,
            percentage: totalVotes === 0 ? 0 : Number(((votes * 100) / totalVotes).toFixed(1)),
          };
        }),
        totalVotes,
        hasVoted: viewerId != null && voterUserIds.includes(normalizeUserId(viewerId)),
      }
    : null;

  const normalized = {
    id: asSerializableId(docId),
    authorUserId: normalizeUserId(rawPost.authorUserId),
    author: rawPost.author || "Unknown",
    handle: rawPost.handle || "@unknown",
    content: rawPost.content || "",
    tags: normalizeTags(rawPost.tags || []),
    mediaUrls: normalizeMediaUrls(rawPost.mediaUrls || []),
    poll,
    parentPostId: rawPost.parentPostId ?? null,
    replyCount: Number(rawPost.replyCount || 0),
    repostCount: Number(rawPost.repostCount || 0),
    likeCount: Number(rawPost.likeCount || 0),
    bookmarkCount: Number(rawPost.bookmarkCount || 0),
    commentCount: Number(rawPost.commentCount || 0),
    createdAt: toIso(rawPost.createdAtMs),
    editedAt: rawPost.editedAtMs ? toIso(rawPost.editedAtMs) : null,
    viewCount: Number(rawPost.viewCount || 0),
  };

  return {
    ...normalized,
    insights: calculateInsightsFromRaw(normalized),
  };
}

function postQueryText(post) {
  return `${post.author} ${post.handle} ${post.content} ${post.tags.join(" ")} ${(post.mediaUrls || []).join(" ")}`
    .toLowerCase();
}

function scorePost(post, viewerId, followedSet) {
  const createdMs = new Date(post.createdAt).getTime();
  const ageHours = Math.max(0.25, (Date.now() - createdMs) / (1000 * 60 * 60));
  const freshness = 58 / (2 + ageHours);
  const engagement = (post.likeCount * 3.0)
    + (post.repostCount * 3.6)
    + (post.replyCount * 2.3)
    + (post.bookmarkCount * 1.9);

  let relationshipBoost = 0;
  const authorId = normalizeUserId(post.authorUserId);
  if (viewerId != null && authorId != null) {
    if (authorId === normalizeUserId(viewerId)) {
      relationshipBoost = 9;
    } else if (followedSet.has(authorId)) {
      relationshipBoost = 6.5;
    }
  }

  const mediaBoost = post.mediaUrls.length ? 1.2 : 0;
  const pollBoost = post.poll ? 0.8 : 0;
  const deterministicNoise = (parseNumericId(post.id) || 0) % 11 / 100;

  return freshness + engagement + relationshipBoost + mediaBoost + pollBoost + deterministicNoise;
}

async function getAllCollectionDocs(collectionName) {
  const snapshot = await getDocs(collection(firestoreDb, collectionName));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

async function ensureFirestoreSeedData() {
  if (seedPromise) {
    return seedPromise;
  }

  seedPromise = (async () => {
    const existingPosts = await getDocs(collection(firestoreDb, POSTS_COLLECTION));
    if (!existingPosts.empty) {
      return;
    }

    const baseNow = nowMs();
    const users = [
      {
        id: 1,
        email: "avery@pulse.dev",
        handle: "@averystone",
        displayName: "Avery Stone",
        bio: "Building in public with thoughtful product loops.",
      },
      {
        id: 2,
        email: "maya@pulse.dev",
        handle: "@mayaops",
        displayName: "Maya Lin",
        bio: "Turning noisy dashboards into clear decisions.",
      },
      {
        id: 3,
        email: "noah@pulse.dev",
        handle: "@noahcreates",
        displayName: "Noah Park",
        bio: "Designing calmer social interaction patterns.",
      },
    ];

    for (const user of users) {
      await setDoc(doc(firestoreDb, USERS_COLLECTION, String(user.id)), {
        ...user,
        createdAtMs: baseNow - (2 * 24 * 60 * 60 * 1000),
        updatedAtMs: baseNow,
      }, { merge: true });
    }

    await setDoc(doc(firestoreDb, FOLLOWS_COLLECTION, "2_1"), {
      followerId: 2,
      followingId: 1,
      createdAtMs: baseNow - (24 * 60 * 60 * 1000),
    });
    await setDoc(doc(firestoreDb, FOLLOWS_COLLECTION, "3_2"), {
      followerId: 3,
      followingId: 2,
      createdAtMs: baseNow - (24 * 60 * 60 * 1000),
    });

    const seededPosts = [
      {
        id: "1001",
        author: "Avery Stone",
        handle: "@averystone",
        authorUserId: 1,
        content: "Rolling out our instant feedback loop. The team shipped from idea to prototype in 48 hours.",
        tags: ["#buildinpublic", "#product"],
        mediaUrls: ["https://images.unsplash.com/photo-1551434678-e076c223a692?q=80&w=1280&auto=format&fit=crop"],
        pollOptions: [],
        pollVotes: {},
        pollVoterUserIds: [],
        parentPostId: null,
        replyCount: 4,
        repostCount: 9,
        likeCount: 27,
        bookmarkCount: 6,
        commentCount: 0,
        likedUserIds: [],
        repostedUserIds: [],
        createdAtMs: baseNow - (2 * 60 * 1000),
        editedAtMs: null,
        viewCount: 126,
      },
      {
        id: "1002",
        author: "Maya Lin",
        handle: "@mayaops",
        authorUserId: 2,
        content: "Small dashboards beat giant reports. If you cannot decide in 30 seconds, it needs less noise.",
        tags: ["#analytics", "#ux"],
        mediaUrls: [],
        pollOptions: ["Keep single KPI", "Show multi-metric"],
        pollVotes: { "Keep single KPI": 11, "Show multi-metric": 17 },
        pollVoterUserIds: [],
        parentPostId: null,
        replyCount: 7,
        repostCount: 15,
        likeCount: 39,
        bookmarkCount: 11,
        commentCount: 0,
        likedUserIds: [],
        repostedUserIds: [],
        createdAtMs: baseNow - (30 * 60 * 1000),
        editedAtMs: null,
        viewCount: 208,
      },
      {
        id: "1003",
        author: "Noah Park",
        handle: "@noahcreates",
        authorUserId: 3,
        content: "Just tested a calmer notification design. Attention is a design material, not free inventory.",
        tags: ["#design", "#frontend"],
        mediaUrls: ["https://images.unsplash.com/photo-1517048676732-d65bc937f952?q=80&w=1280&auto=format&fit=crop"],
        pollOptions: [],
        pollVotes: {},
        pollVoterUserIds: [],
        parentPostId: "1001",
        replyCount: 2,
        repostCount: 5,
        likeCount: 20,
        bookmarkCount: 4,
        commentCount: 0,
        likedUserIds: [],
        repostedUserIds: [],
        createdAtMs: baseNow - (60 * 60 * 1000),
        editedAtMs: null,
        viewCount: 154,
      },
    ];

    for (const post of seededPosts) {
      await setDoc(doc(firestoreDb, POSTS_COLLECTION, post.id), post, { merge: true });
    }
  })();

  try {
    await seedPromise;
  } catch (error) {
    seedPromise = null;
    throw error;
  }
}

function normalizeUser(rawUser, id) {
  const normalizedId = normalizeUserId(rawUser.id)
    ?? normalizeUserId(rawUser.authUid)
    ?? normalizeUserId(rawUser.uid)
    ?? normalizeUserId(id);
  const inferredHandleSource = rawUser.handle
    || rawUser.displayName
    || rawUser.email
    || normalizedId
    || "user";

  return {
    id: normalizedId,
    authUid: normalizeUserId(rawUser.authUid) ?? normalizedId,
    email: rawUser.email || "",
    handle: rawUser.handle || buildHandleCandidate(inferredHandleSource, normalizedId || "user"),
    displayName: rawUser.displayName || `User ${normalizedId || "unknown"}`,
    bio: rawUser.bio || "",
    createdAtMs: Number(rawUser.createdAtMs || 0),
  };
}

async function getUsersById() {
  const userDocs = await getAllCollectionDocs(USERS_COLLECTION);
  const map = new Map();

  for (const item of userDocs) {
    const user = normalizeUser(item, item.id);
    if (user.id != null) {
      map.set(user.id, user);
    }
  }

  return map;
}

async function getFollows() {
  const followDocs = await getAllCollectionDocs(FOLLOWS_COLLECTION);
  return followDocs
    .map((follow) => ({
      followerId: normalizeUserId(follow.followerId),
      followingId: normalizeUserId(follow.followingId),
      createdAtMs: Number(follow.createdAtMs || 0),
    }))
    .filter((follow) => follow.followerId != null && follow.followingId != null);
}

async function getCurrentUserProfile() {
  const actorId = getCurrentUserId(false);
  const ref = doc(firestoreDb, USERS_COLLECTION, String(actorId));
  const existing = await getDoc(ref);

  if (existing.exists()) {
    return normalizeUser(existing.data(), existing.id);
  }

  const payload = decodeTokenPayload(readToken()) || {};
  const inferredHandle = buildHandleCandidate(
    payload.handle || payload.preferred_username || payload.name || payload.email || actorId,
    actorId
  );
  const inferredDisplayName = String(payload.name || payload.display_name || "")
    .trim()
    || inferredHandle.replace(/^@/, "")
    || `User ${actorId}`;
  const profile = {
    id: actorId,
    authUid: actorId,
    email: payload.email || "",
    handle: inferredHandle,
    displayName: inferredDisplayName,
    bio: "Building in public on Pulse.",
    createdAtMs: nowMs(),
  };

  await setDoc(ref, {
    ...profile,
    updatedAtMs: nowMs(),
  }, { merge: true });

  return profile;
}

async function createNotification(recipientId, type, message) {
  const targetId = normalizeUserId(recipientId);
  if (targetId == null) {
    return;
  }

  const notificationId = newEntityId();
  await setDoc(doc(firestoreDb, NOTIFICATIONS_COLLECTION, notificationId), {
    recipientId: targetId,
    type,
    message,
    isRead: false,
    createdAtMs: nowMs(),
  });
}

function normalizeNotification(rawNotification, id) {
  return {
    id: asSerializableId(id),
    type: rawNotification.type || "update",
    message: rawNotification.message || "",
    isRead: Boolean(rawNotification.isRead),
    createdAt: toIso(rawNotification.createdAtMs),
  };
}

function buildUserProfile(user, follows, currentUserId) {
  const followers = follows.filter((follow) => follow.followingId === user.id).length;
  const following = follows.filter((follow) => follow.followerId === user.id).length;
  const followedByCurrentUser = follows.some((follow) => (
    follow.followerId === normalizeUserId(currentUserId) && follow.followingId === user.id
  ));

  return {
    id: user.id,
    email: user.email,
    handle: user.handle,
    displayName: user.displayName,
    bio: user.bio,
    followers,
    following,
    followedByCurrentUser,
  };
}

export async function syncAuthUserToFirestore(user) {
  if (!user) {
    return;
  }

  const userId = normalizeUserId(user.authUid)
    ?? normalizeUserId(user.uid)
    ?? normalizeUserId(user.id);
  if (userId == null) {
    return;
  }

  const ref = doc(firestoreDb, USERS_COLLECTION, String(userId));
  const current = await getDoc(ref);
  const createdAtMs = current.exists()
    ? Number(current.data().createdAtMs || nowMs())
    : nowMs();

  const handle = buildHandleCandidate(user.handle || user.displayName || user.email || userId, userId);
  const displayName = String(user.displayName || "").trim() || handle.replace(/^@/, "") || `User ${userId}`;
  const mergedProfile = {
    id: userId,
    authUid: userId,
    email: user.email || "",
    handle,
    displayName,
    bio: user.bio || "",
    createdAtMs,
    updatedAtMs: nowMs(),
  };

  await setDoc(ref, mergedProfile, { merge: true });
  return normalizeUser(mergedProfile, userId);
}

export async function getPostsFromFirestore({ query = "", page = 0, size = 10 } = {}) {
  await ensureFirestoreSeedData();

  const viewerId = getCurrentUserId(true);
  const follows = viewerId == null ? [] : await getFollows();
  const followedSet = new Set(follows
    .filter((follow) => follow.followerId === viewerId)
    .map((follow) => follow.followingId));

  const postDocs = await getAllCollectionDocs(POSTS_COLLECTION);
  const posts = postDocs.map((rawPost) => normalizePostResponse(rawPost, rawPost.id, viewerId));

  const ranked = [...posts]
    .sort((left, right) => scorePost(right, viewerId, followedSet) - scorePost(left, viewerId, followedSet));

  const loweredQuery = query.trim().toLowerCase();
  const filtered = loweredQuery
    ? ranked.filter((post) => postQueryText(post).includes(loweredQuery))
    : ranked;

  const safePage = Math.max(0, Number(page || 0));
  const safeSize = Math.max(1, Math.min(50, Number(size || 10)));
  const start = safePage * safeSize;
  const items = filtered.slice(start, start + safeSize);

  return {
    items,
    page: safePage,
    size: safeSize,
    totalElements: filtered.length,
    hasNext: start + safeSize < filtered.length,
  };
}

export async function getPersonalizedFeedFromFirestore({ query = "", page = 0, size = 10 } = {}) {
  await ensureFirestoreSeedData();

  const viewerId = getCurrentUserId(false);
  const follows = await getFollows();
  const followedSet = new Set(follows
    .filter((follow) => follow.followerId === viewerId)
    .map((follow) => follow.followingId));

  const postDocs = await getAllCollectionDocs(POSTS_COLLECTION);
  const posts = postDocs
    .filter((rawPost) => {
      const authorUserId = normalizeUserId(rawPost.authorUserId);
      return authorUserId === viewerId || followedSet.has(authorUserId);
    })
    .map((rawPost) => normalizePostResponse(rawPost, rawPost.id, viewerId));

  const ranked = [...posts]
    .sort((left, right) => scorePost(right, viewerId, followedSet) - scorePost(left, viewerId, followedSet));

  const loweredQuery = query.trim().toLowerCase();
  const filtered = loweredQuery
    ? ranked.filter((post) => postQueryText(post).includes(loweredQuery))
    : ranked;

  const safePage = Math.max(0, Number(page || 0));
  const safeSize = Math.max(1, Math.min(50, Number(size || 10)));
  const start = safePage * safeSize;
  const items = filtered.slice(start, start + safeSize);

  return {
    items,
    page: safePage,
    size: safeSize,
    totalElements: filtered.length,
    hasNext: start + safeSize < filtered.length,
  };
}

export async function createPostInFirestore(payload) {
  await ensureFirestoreSeedData();

  const actor = await getCurrentUserProfile();
  const postId = newEntityId();
  const pollOptions = normalizePollOptions(payload.pollOptions || []);

  const data = {
    author: actor.displayName,
    handle: actor.handle,
    authorUserId: actor.id,
    content: String(payload.content || "").trim(),
    tags: normalizeTags(payload.tags || []),
    mediaUrls: normalizeMediaUrls(payload.mediaUrls || []),
    pollOptions,
    pollVotes: pollOptions.reduce((accumulator, option) => ({ ...accumulator, [option]: 0 }), {}),
    pollVoterUserIds: [],
    parentPostId: payload.parentPostId != null ? String(payload.parentPostId) : null,
    replyCount: 0,
    repostCount: 0,
    likeCount: 0,
    bookmarkCount: 0,
    commentCount: 0,
    likedUserIds: [],
    repostedUserIds: [],
    createdAtMs: nowMs(),
    editedAtMs: null,
    viewCount: 0,
  };

  await setDoc(doc(firestoreDb, POSTS_COLLECTION, postId), data);
  return normalizePostResponse(data, postId, actor.id);
}

export async function editPostInFirestore(postId, content) {
  const actorId = getCurrentUserId(false);
  const ref = doc(firestoreDb, POSTS_COLLECTION, String(postId));
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    throw new Error("Post not found");
  }

  const current = snap.data();
  if (!userIdsEqual(current.authorUserId, actorId)) {
    throw new Error("Only the post author can edit this post");
  }

  const updated = {
    content: String(content || "").trim(),
    editedAtMs: nowMs(),
  };

  await updateDoc(ref, updated);
  return normalizePostResponse({ ...current, ...updated }, snap.id, actorId);
}

export async function votePollInFirestore(postId, option) {
  const actorId = getCurrentUserId(false);
  const ref = doc(firestoreDb, POSTS_COLLECTION, String(postId));
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    throw new Error("Post not found");
  }

  const current = snap.data();
  const pollOptions = normalizePollOptions(current.pollOptions || []);
  if (!pollOptions.length) {
    throw new Error("This post does not have an active poll");
  }

  const canonicalOption = pollOptions.find((item) => item.toLowerCase() === String(option || "").trim().toLowerCase());
  if (!canonicalOption) {
    throw new Error("Invalid poll option");
  }

  const voterIds = Array.isArray(current.pollVoterUserIds)
    ? current.pollVoterUserIds.map((value) => normalizeUserId(value)).filter((value) => value != null)
    : [];

  if (voterIds.includes(normalizeUserId(actorId))) {
    throw new Error("You already voted in this poll");
  }

  const nextVotes = { ...(current.pollVotes || {}) };
  nextVotes[canonicalOption] = Number(nextVotes[canonicalOption] || 0) + 1;

  const updates = {
    pollVotes: nextVotes,
    pollVoterUserIds: [...voterIds, normalizeUserId(actorId)],
  };

  await updateDoc(ref, updates);
  return normalizePostResponse({ ...current, ...updates }, snap.id, actorId);
}

export async function getPostInsightsFromFirestore(postId) {
  const viewerId = getCurrentUserId(true);
  const ref = doc(firestoreDb, POSTS_COLLECTION, String(postId));
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    throw new Error("Post not found");
  }

  const normalized = normalizePostResponse(snap.data(), snap.id, viewerId);
  return normalized.insights;
}

export async function engageInFirestore(postId, action) {
  const actorId = getCurrentUserId(false);
  const actor = await getCurrentUserProfile();
  const ref = doc(firestoreDb, POSTS_COLLECTION, String(postId));
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    throw new Error("Post not found");
  }

  const current = snap.data();
  const normalizedAction = String(action || "").toLowerCase();

  const likedUserIds = normalizeStringArray(current.likedUserIds || [], 500).map((value) => normalizeUserId(value)).filter((value) => value != null);
  const repostedUserIds = normalizeStringArray(current.repostedUserIds || [], 500).map((value) => normalizeUserId(value)).filter((value) => value != null);

  const updates = {};
  let notifyAuthor = false;

  if (normalizedAction === "reply") {
    updates.replyCount = Number(current.replyCount || 0) + 1;
    notifyAuthor = true;
  } else if (normalizedAction === "repost") {
    if (!repostedUserIds.includes(actorId)) {
      updates.repostCount = Number(current.repostCount || 0) + 1;
      updates.repostedUserIds = [...repostedUserIds, actorId];
      notifyAuthor = true;
    }
  } else if (normalizedAction === "like") {
    if (!likedUserIds.includes(actorId)) {
      updates.likeCount = Number(current.likeCount || 0) + 1;
      updates.likedUserIds = [...likedUserIds, actorId];
      notifyAuthor = true;
    }
  } else if (normalizedAction === "bookmark") {
    updates.bookmarkCount = Number(current.bookmarkCount || 0) + 1;
    notifyAuthor = true;
  } else {
    throw new Error(`Unsupported action: ${action}`);
  }

  if (Object.keys(updates).length > 0) {
    await updateDoc(ref, updates);
  }

  const merged = { ...current, ...updates };
  const authorUserId = normalizeUserId(merged.authorUserId);
  if (notifyAuthor && authorUserId != null && !userIdsEqual(authorUserId, actorId)) {
    await createNotification(authorUserId, normalizedAction, `${actor.displayName} engaged with your post`);
  }

  return normalizePostResponse(merged, snap.id, actorId);
}

export async function getDashboardFromFirestore() {
  await ensureFirestoreSeedData();

  const postDocs = await getAllCollectionDocs(POSTS_COLLECTION);
  const posts = postDocs.map((rawPost) => normalizePostResponse(rawPost, rawPost.id, getCurrentUserId(true)));

  const totalPosts = posts.length;
  const totalLikes = posts.reduce((sum, post) => sum + post.likeCount, 0);
  const totalReposts = posts.reduce((sum, post) => sum + post.repostCount, 0);
  const totalReplies = posts.reduce((sum, post) => sum + post.replyCount, 0);
  const savedPosts = posts.reduce((sum, post) => sum + post.bookmarkCount, 0);
  const totalEngagement = totalLikes + totalReposts + totalReplies + savedPosts;
  const averageLikes = totalPosts === 0 ? 0 : Math.round(totalLikes / totalPosts);

  const trendMap = new Map();
  posts.forEach((post) => {
    const score = post.likeCount + post.repostCount + post.bookmarkCount;
    post.tags.forEach((tag) => {
      trendMap.set(tag, (trendMap.get(tag) || 0) + score);
    });
  });

  const trends = [...trendMap.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6)
    .map(([tag, score]) => ({ tag, score }));

  const weeklyActivity = [45, 52, 38, 60, 66, 58, Math.min(100, 49 + totalPosts * 2)];

  return {
    totalPosts,
    totalEngagement,
    averageLikes,
    savedPosts,
    trends,
    weeklyActivity,
    missingFunctionalities: fallbackGaps,
  };
}

export async function getSuggestedUsersFromFirestore() {
  await ensureFirestoreSeedData();

  const actorId = getCurrentUserId(false);
  const usersMap = await getUsersById();
  const follows = await getFollows();

  return [...usersMap.values()]
    .filter((user) => user.id !== actorId)
    .sort((left, right) => right.createdAtMs - left.createdAtMs)
    .slice(0, 8)
    .map((user) => buildUserProfile(user, follows, actorId));
}

export async function followUserInFirestore(userId) {
  await ensureFirestoreSeedData();

  const actor = await getCurrentUserProfile();
  const targetId = normalizeUserId(userId);
  if (targetId == null) {
    throw new Error("Target user id is required");
  }
  if (userIdsEqual(targetId, actor.id)) {
    throw new Error("You cannot follow yourself");
  }

  const usersMap = await getUsersById();
  if (!usersMap.has(targetId)) {
    throw new Error("Target user not found");
  }

  await setDoc(doc(firestoreDb, FOLLOWS_COLLECTION, `${actor.id}_${targetId}`), {
    followerId: actor.id,
    followingId: targetId,
    createdAtMs: nowMs(),
  }, { merge: true });

  await createNotification(targetId, "follow", `${actor.displayName} started following you`);

  const follows = await getFollows();
  return buildUserProfile(usersMap.get(targetId), follows, actor.id);
}

export async function unfollowUserInFirestore(userId) {
  await ensureFirestoreSeedData();

  const actor = await getCurrentUserProfile();
  const targetId = normalizeUserId(userId);
  if (targetId == null) {
    throw new Error("Target user id is required");
  }

  await deleteDoc(doc(firestoreDb, FOLLOWS_COLLECTION, `${actor.id}_${targetId}`));

  const usersMap = await getUsersById();
  const targetUser = usersMap.get(targetId);
  if (!targetUser) {
    throw new Error("Target user not found");
  }

  const follows = await getFollows();
  return buildUserProfile(targetUser, follows, actor.id);
}

export async function getNotificationsFromFirestore() {
  await ensureFirestoreSeedData();

  const actorId = getCurrentUserId(false);
  const notifications = await getAllCollectionDocs(NOTIFICATIONS_COLLECTION);

  return notifications
    .filter((item) => userIdsEqual(item.recipientId, actorId))
    .sort((left, right) => Number(right.createdAtMs || 0) - Number(left.createdAtMs || 0))
    .slice(0, 40)
    .map((item) => normalizeNotification(item, item.id));
}

export async function getUnreadNotificationCountFromFirestore() {
  const notifications = await getNotificationsFromFirestore();
  return {
    count: notifications.filter((item) => !item.isRead).length,
  };
}

export async function markNotificationReadInFirestore(notificationId) {
  const ref = doc(firestoreDb, NOTIFICATIONS_COLLECTION, String(notificationId));
  await updateDoc(ref, { isRead: true });
  return { status: "ok" };
}

export function createNotificationStreamFromFirestore(onNotification, onError) {
  ensureFirestoreSeedData().catch(() => {
    // Stream can still work without initial seed.
  });

  const actorId = getCurrentUserId(true);
  if (actorId == null) {
    return null;
  }

  const seen = new Set();
  let initialized = false;

  const unsubscribe = onSnapshot(
    collection(firestoreDb, NOTIFICATIONS_COLLECTION),
    (snapshot) => {
      const notifications = snapshot.docs
        .map((item) => ({
          raw: item.data(),
          normalized: normalizeNotification(item.data(), item.id),
        }))
        .filter((item) => userIdsEqual(item.raw.recipientId, actorId))
        .map((item) => item.normalized)
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());

      if (!initialized) {
        notifications.forEach((item) => seen.add(String(item.id)));
        initialized = true;
        return;
      }

      notifications.forEach((item) => {
        const id = String(item.id);
        if (seen.has(id)) {
          return;
        }
        seen.add(id);
        onNotification(item);
      });
    },
    (error) => {
      if (onError) {
        onError(error);
      }
    }
  );

  return {
    close: unsubscribe,
  };
}

function postSignature(post) {
  return [
    post.content,
    post.editedAt,
    post.likeCount,
    post.repostCount,
    post.replyCount,
    post.bookmarkCount,
    post.commentCount,
    post.viewCount,
    post.poll ? post.poll.totalVotes : 0,
  ].join("|");
}

export function createFeedStreamFromFirestore(onFeedEvent, onError) {
  ensureFirestoreSeedData().catch(() => {
    // Stream can still work without initial seed.
  });

  const signatures = new Map();
  let initialized = false;

  const unsubscribe = onSnapshot(
    collection(firestoreDb, POSTS_COLLECTION),
    (snapshot) => {
      const viewerId = getCurrentUserId(true);
      const current = new Map();

      snapshot.docs.forEach((item) => {
        const post = normalizePostResponse(item.data(), item.id, viewerId);
        current.set(item.id, {
          signature: postSignature(post),
          post,
        });
      });

      if (!initialized) {
        current.forEach((value, key) => signatures.set(key, value.signature));
        initialized = true;
        return;
      }

      current.forEach((value, key) => {
        if (!signatures.has(key)) {
          onFeedEvent({
            eventType: "post_created",
            postId: value.post.id,
            post: value.post,
            occurredAt: new Date().toISOString(),
          });
          return;
        }

        if (signatures.get(key) !== value.signature) {
          onFeedEvent({
            eventType: "post_updated",
            postId: value.post.id,
            post: value.post,
            occurredAt: new Date().toISOString(),
          });
        }
      });

      signatures.clear();
      current.forEach((value, key) => signatures.set(key, value.signature));
    },
    (error) => {
      if (onError) {
        onError(error);
      }
    }
  );

  return {
    close: unsubscribe,
  };
}

function normalizeComment(rawComment, id) {
  return {
    id: asSerializableId(id),
    postId: asSerializableId(rawComment.postId),
    author: rawComment.author || "Unknown",
    handle: rawComment.handle || "@unknown",
    content: rawComment.content || "",
    createdAt: toIso(rawComment.createdAtMs),
  };
}

export async function getCommentsFromFirestore(postId) {
  await ensureFirestoreSeedData();

  const comments = await getAllCollectionDocs(COMMENTS_COLLECTION);
  return comments
    .filter((item) => String(item.postId) === String(postId))
    .sort((left, right) => Number(left.createdAtMs || 0) - Number(right.createdAtMs || 0))
    .map((item) => normalizeComment(item, item.id));
}

export async function addCommentInFirestore(postId, content) {
  const actor = await getCurrentUserProfile();
  const trimmed = String(content || "").trim();
  if (!trimmed) {
    throw new Error("Comment content is required");
  }

  const postRef = doc(firestoreDb, POSTS_COLLECTION, String(postId));
  const postSnap = await getDoc(postRef);
  if (!postSnap.exists()) {
    throw new Error("Post not found");
  }

  const commentId = newEntityId();
  const comment = {
    postId: String(postId),
    authorUserId: actor.id,
    author: actor.displayName,
    handle: actor.handle,
    content: trimmed,
    createdAtMs: nowMs(),
  };

  await setDoc(doc(firestoreDb, COMMENTS_COLLECTION, commentId), comment);

  const post = postSnap.data();
  const nextCommentCount = Number(post.commentCount || 0) + 1;
  const nextReplyCount = Number(post.replyCount || 0) + 1;
  await updateDoc(postRef, {
    commentCount: nextCommentCount,
    replyCount: nextReplyCount,
  });

  const authorUserId = normalizeUserId(post.authorUserId);
  if (authorUserId != null && !userIdsEqual(authorUserId, actor.id)) {
    await createNotification(authorUserId, "comment", `${actor.displayName} commented on your post`);
  }

  return normalizeComment(comment, commentId);
}

function normalizeMessage(rawMessage, id, currentUserId) {
  const senderId = normalizeUserId(rawMessage.senderId);
  const recipientId = normalizeUserId(rawMessage.recipientId);
  return {
    id: asSerializableId(id),
    senderId: asSerializableId(senderId ?? rawMessage.senderId),
    senderDisplayName: rawMessage.senderDisplayName || "Unknown",
    recipientId: asSerializableId(recipientId ?? rawMessage.recipientId),
    recipientDisplayName: rawMessage.recipientDisplayName || "Unknown",
    content: rawMessage.content || "",
    createdAt: toIso(rawMessage.createdAtMs),
    readAt: rawMessage.readAtMs ? toIso(rawMessage.readAtMs) : null,
    mine: userIdsEqual(senderId, currentUserId),
  };
}

export async function getMessageInboxFromFirestore() {
  await ensureFirestoreSeedData();

  const actorId = getCurrentUserId(false);
  const messages = await getAllCollectionDocs(MESSAGES_COLLECTION);
  const relevant = messages
    .filter((message) => userIdsEqual(message.senderId, actorId) || userIdsEqual(message.recipientId, actorId))
    .sort((left, right) => Number(right.createdAtMs || 0) - Number(left.createdAtMs || 0));

  const grouped = new Map();
  for (const message of relevant) {
    const senderId = normalizeUserId(message.senderId);
    const recipientId = normalizeUserId(message.recipientId);
    const peerId = userIdsEqual(senderId, actorId) ? recipientId : senderId;

    if (peerId == null || grouped.has(peerId)) {
      continue;
    }
    grouped.set(peerId, message);
  }

  const users = await getUsersById();

  return [...grouped.entries()]
    .map(([peerId, latest]) => {
      const peer = users.get(peerId) || {
        id: peerId,
        handle: `@user${peerId}`,
        displayName: `User ${peerId}`,
        bio: "",
      };

      const unreadCount = relevant.filter((message) => (
        userIdsEqual(message.senderId, peerId)
        && userIdsEqual(message.recipientId, actorId)
        && !message.readAtMs
      )).length;

      return {
        peerId: asSerializableId(peerId),
        peerHandle: peer.handle,
        peerDisplayName: peer.displayName,
        peerBio: peer.bio,
        lastMessage: latest.content || "",
        lastMessageAt: toIso(latest.createdAtMs),
        unreadCount,
      };
    })
    .sort((left, right) => new Date(right.lastMessageAt).getTime() - new Date(left.lastMessageAt).getTime());
}

export async function getMessageThreadFromFirestore(peerId) {
  await ensureFirestoreSeedData();

  const actorId = getCurrentUserId(false);
  const normalizedPeerId = normalizeUserId(peerId);
  if (normalizedPeerId == null) {
    return [];
  }

  const messages = await getAllCollectionDocs(MESSAGES_COLLECTION);
  return messages
    .filter((message) => {
      const senderId = normalizeUserId(message.senderId);
      const recipientId = normalizeUserId(message.recipientId);
      return (userIdsEqual(senderId, actorId) && userIdsEqual(recipientId, normalizedPeerId))
        || (userIdsEqual(senderId, normalizedPeerId) && userIdsEqual(recipientId, actorId));
    })
    .sort((left, right) => Number(left.createdAtMs || 0) - Number(right.createdAtMs || 0))
    .map((message) => normalizeMessage(message, message.id, actorId));
}

export async function sendMessageInFirestore(recipientId, content) {
  await ensureFirestoreSeedData();

  const actor = await getCurrentUserProfile();
  const targetId = normalizeUserId(recipientId);
  if (targetId == null || userIdsEqual(targetId, actor.id)) {
    throw new Error("Invalid recipient");
  }

  const users = await getUsersById();
  const recipient = users.get(targetId);
  if (!recipient) {
    throw new Error("Recipient not found");
  }

  const messageId = newEntityId();
  const message = {
    senderId: actor.id,
    senderDisplayName: actor.displayName,
    recipientId: targetId,
    recipientDisplayName: recipient.displayName,
    content: String(content || "").trim(),
    createdAtMs: nowMs(),
    readAtMs: null,
  };

  await setDoc(doc(firestoreDb, MESSAGES_COLLECTION, messageId), message);
  await createNotification(targetId, "message", `${actor.displayName} sent you a message`);

  return normalizeMessage(message, messageId, actor.id);
}

export async function markMessageThreadReadInFirestore(peerId) {
  const actorId = getCurrentUserId(false);
  const normalizedPeerId = normalizeUserId(peerId);
  if (normalizedPeerId == null) {
    return { status: "ok" };
  }

  const messages = await getAllCollectionDocs(MESSAGES_COLLECTION);
  const unread = messages.filter((message) => (
    userIdsEqual(message.senderId, normalizedPeerId)
    && userIdsEqual(message.recipientId, actorId)
    && !message.readAtMs
  ));

  const readAtMs = nowMs();
  await Promise.all(unread.map((message) => updateDoc(
    doc(firestoreDb, MESSAGES_COLLECTION, String(message.id)),
    { readAtMs }
  )));

  return { status: "ok" };
}
